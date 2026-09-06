import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { ProjectSidebar } from './project-sidebar'
import type { GitWorktreeList } from '@shared/git-worktree'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), activate: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({ activateWorkspace: mocks.activate, switchSessionInPlace: vi.fn(), previewSessionInPlace: vi.fn() }))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

const repo: GitWorktreeList = { ok: true, repositoryPath: '/repo', trees: [
  { path: '/repo', branch: 'main', isMain: true, detached: false },
  { path: '/copies/feature', branch: 'feature/sidebar', isMain: false, detached: false },
] }
let failSessions = false

beforeEach(() => {
  __resetRefreshWorkspaceSessionListsForTests()
  mocks.invoke.mockReset()
  mocks.activate.mockReset()
  failSessions = false
  useUIStore.setState({ currentWorkspace: '/copies/feature', recentProjects: [], sessions: [], sessionsWorkspace: null,
    currentSessionId: null, historySessionFile: null, timelineItems: [], subagentSessionGroup: null,
    sessionAttention: {}, sidebarCollapsed: false, ephemeralSandboxDraft: false,
  })
  mocks.invoke.mockImplementation(async (method: string, req?: { workspaceId?: string; key?: string }) => {
    if (method === 'settings.get') return { settings: { recentProjects: ['/repo', '/copies/feature', '/notes'], recentProjectsFixedOrder: true } }
    if (method === 'desktop.gitWorktrees') return req?.workspaceId === '/notes' ? { ok: true, trees: [], repositoryPath: null } : repo
    if (method === 'workspace.sandbox.list') return { sandboxes: [] }
    if (method === 'session.list') {
      if (failSessions) throw new Error('preview unavailable')
      const path = req?.workspaceId || ''
      return { sessions: [{ sessionId: path, sessionFile: `${path}/session.jsonl`, workspaceId: path, title: `${path} question`, firstMessage: 'lookup this prompt', updatedAt: 1, modelId: '' }] }
    }
    return { ok: true }
  })
})

function sidebar() {
  return render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
}

describe('repository / checkout / session sidebar', () => {
  it('nests valid checkouts once and reads only the active checkout on startup', async () => {
    const { container } = sidebar()
    const repository = await screen.findByRole('group', { name: 'repo' })
    await screen.findByText('/copies/feature question')
    expect(repository.querySelectorAll('.sidebar-project-row')).toHaveLength(2)
    expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(3)
    expect(within(repository).getByText('Main checkout')).toBeTruthy()
    const feature = container.querySelector('[data-workspace="/copies/feature"]')!
    expect(feature.textContent).toContain('/copies/feature question')
    expect(feature.textContent).not.toContain('/repo question')
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'session.list')).toEqual([
      ['session.list', { workspaceId: '/copies/feature', refresh: true }],
    ])
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'desktop.gitWorktrees').every(([, req]) => !!req.workspaceId)).toBe(true)
  })

  it('keeps one scope switch inside the search frame and returns focus after clearing', async () => {
    const { container } = sidebar()
    await screen.findByText('/copies/feature question')
    const input = screen.getByRole('searchbox')
    fireEvent.focus(input)
    const scope = screen.getByRole('switch', { name: 'All projects' })
    const frame = input.closest('.workbench-search')!
    expect(frame).toContainElement(scope)
    expect(scope).toHaveAttribute('aria-checked', 'false')
    expect(container.querySelector('[role="group"][aria-label="Search scope"]')).toBeNull()
    fireEvent.change(input, { target: { value: 'lookup' } })
    fireEvent.click(scope)
    expect(input).toHaveValue('lookup')
    expect(scope).toHaveAttribute('aria-checked', 'true')
    await screen.findByText('/repo question')
    const clear = within(frame as HTMLElement).getByRole('button', { name: 'Clear search' })
    clear.focus()
    fireEvent.click(clear)
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
    expect(scope).toHaveAttribute('aria-checked', 'true')
  })

  it('searches other known checkouts only in all-project search and opens the right directory', async () => {
    const { container } = sidebar()
    await screen.findByText('/copies/feature question')
    fireEvent.focus(screen.getByRole('searchbox'))
    fireEvent.click(screen.getByRole('switch', { name: 'All projects' }))
    expect(mocks.invoke.mock.calls.filter(([method]) => method === 'session.list')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lookup' } })
    await screen.findByText('/repo question')
    await screen.findByText('/notes question')
    fireEvent.click(container.querySelector('[data-workspace="/repo"] .sidebar-project-hit')!)
    expect(mocks.activate).toHaveBeenCalledWith('/repo')
    fireEvent.click(screen.getByRole('switch', { name: 'All projects' }))
    expect(screen.queryByText('/repo question')).toBeNull()
    expect(screen.queryByText('/notes question')).toBeNull()
    expect(screen.getByText('/copies/feature question')).toBeTruthy()
  })

  it('searches a child without stripping its parent from the project tree', async () => {
    const invoke = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (method, req) => {
      if (method === 'session.list') return { sessions: [
        { sessionId: 'root', sessionFile: '/sessions/root.jsonl', title: 'Build sidebar', updatedAt: 1, modelId: '' },
        { sessionId: 'child', sessionFile: '/sessions/child.jsonl', parentSessionFile: '/sessions/root.jsonl', title: 'Review findings', firstMessage: 'needle', updatedAt: 2, modelId: '' },
      ] }
      return invoke(method, req)
    })
    const { container } = sidebar()
    await screen.findByText('Build sidebar')
    expect(screen.queryByText('Review findings')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'needle' } })
    expect(screen.getByText('Build sidebar')).toBeInTheDocument()
    expect(screen.getByText('Review findings')).toBeInTheDocument()
    expect(container.querySelectorAll('.sidebar-session-tree > [data-session-file]')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    expect(screen.queryByText('Review findings')).not.toBeInTheDocument()
  })

  it('shows a retryable read error instead of claiming an unread directory has no sessions', async () => {
    failSessions = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    sidebar()
    await screen.findByText('Sessions could not be loaded. Please try again.')
    failSessions = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('/copies/feature question')
    expect(screen.queryByText('Sessions could not be loaded. Please try again.')).toBeNull()
    log.mockRestore()
  })

  it('hides removed recent worktrees instead of restoring them as ordinary projects', async () => {
    const invoke = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (method, req) => {
      if (method === 'settings.get') return { settings: { recentProjects: ['/repo', '/copies/feature', '/gone'], recentProjectsFixedOrder: true } }
      if (method === 'desktop.gitWorktrees' && req.workspaceId === '/gone') return { ok: true, trees: [], repositoryPath: null, missing: true }
      return invoke(method, req)
    })
    const { container } = sidebar()
    await screen.findByText('/copies/feature question')
    await waitFor(() => expect(container.querySelector('[data-workspace="/gone"]')).toBeNull())
    expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(2)
  })

  it('does not resurrect a deleted last session after a workspace switch', async () => {
    const { container } = sidebar()
    await screen.findByText('/copies/feature question')
    await act(async () => { useUIStore.getState().setSessions([]) })
    expect(screen.queryByText('/copies/feature question')).toBeNull()
    mocks.invoke.mockImplementation(async (method: string, req?: { key?: string; workspaceId?: string }) => {
      if (method === 'session.list') return { sessions: [] }
      if (method === 'desktop.gitWorktrees') return repo
      if (method === 'settings.get') return { settings: { recentProjects: ['/repo', '/copies/feature'], recentProjectsFixedOrder: true } }
      return { sandboxes: [] }
    })
    await act(async () => { useUIStore.getState().setWorkspace('/repo') })
    await waitFor(() => expect(container.querySelector('[data-workspace="/repo"] [aria-current="location"]')).toBeTruthy())
    expect(screen.queryByText('/copies/feature question')).toBeNull()
  })
})
