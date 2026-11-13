import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { ProjectSidebar } from './project-sidebar'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({ activateWorkspace: vi.fn(), switchSessionInPlace: vi.fn(), previewSessionInPlace: vi.fn() }))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

let stored: string[] = []

beforeEach(() => {
  __resetRefreshWorkspaceSessionListsForTests()
  localStorage.clear()
  mocks.invoke.mockReset()
  stored = ['/a', '/b']
  useUIStore.setState({ currentWorkspace: '/a', recentProjects: [], sessions: [], sessionsWorkspace: null,
    currentSessionId: null, historySessionFile: null, timelineItems: [], subagentSessionGroup: null,
    sessionAttention: {}, sidebarCollapsed: false, ephemeralSandboxDraft: false,
  })
  mocks.invoke.mockImplementation(async (method: string, req?: { key?: string; value?: string[]; workspaceId?: string }) => {
    if (method === 'settings.get' && req?.key === 'recentProjects') return { settings: { recentProjects: stored } }
    if (method === 'settings.get') return { settings: { recentProjectsFixedOrder: true } }
    if (method === 'settings.set' && req?.key === 'recentProjects') {
      stored = req.value!
      return { ok: true }
    }
    if (method === 'desktop.gitWorktrees') return { ok: true, trees: [], repositoryPath: null }
    if (method === 'workspace.sandbox.list') return { sandboxes: [] }
    if (method === 'session.list') {
      const at = (n: number) => ({ sessionId: `s${n}`, sessionFile: `/a/s${n}.jsonl`, workspaceId: '/a', title: `chat ${n}`, firstMessage: '', updatedAt: 400 - n * 100, modelId: '' })
      return req?.workspaceId === '/a' ? { sessions: [at(1), at(2), at(3)] } : { sessions: [] }
    }
    return { ok: true }
  })
})

function dataTransfer() {
  return { setData: vi.fn(), getData: vi.fn(() => ''), setDragImage: vi.fn(), types: [] as string[], effectAllowed: '', dropEffect: '' }
}

/**
 * Drag `from` onto the top (clientY -1) or bottom half (clientY 1) of `to`. jsdom rows have zero
 * height and its drag events drop `clientY`, so it is set on each event by hand.
 */
function drag(from: Element, to: Element, half: 'top' | 'bottom') {
  const transfer = dataTransfer()
  const clientY = half === 'top' ? -1 : 1
  const at = (event: Event) => {
    Object.defineProperty(event, 'clientY', { value: clientY })
    return event
  }
  fireEvent.dragStart(from, { dataTransfer: transfer })
  fireEvent(to, at(createEvent.dragOver(to, { dataTransfer: transfer })))
  fireEvent(to, at(createEvent.drop(to, { dataTransfer: transfer })))
  fireEvent.dragEnd(from, { dataTransfer: transfer })
}

const sessionOrder = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-workspace="/a"] [data-session-file]')].map((row) => row.getAttribute('data-session-file'))

describe('drag to reorder in the sidebar', () => {
  it('should_move_a_conversation_and_keep_its_place_after_a_reload', async () => {
    const { container, unmount } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await screen.findByText('chat 3')
    const row = (n: number) => container.querySelector(`[data-session-file="/a/s${n}.jsonl"]`)!

    drag(row(3), row(1), 'top')

    expect(sessionOrder(container)).toEqual(['/a/s3.jsonl', '/a/s1.jsonl', '/a/s2.jsonl'])
    unmount()
    const again = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await waitFor(() => expect(sessionOrder(again.container)).toEqual(['/a/s3.jsonl', '/a/s1.jsonl', '/a/s2.jsonl']))
  })

  it('should_not_reorder_while_searching', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await screen.findByText('chat 3')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'chat' } })
    const row = (n: number) => container.querySelector(`[data-session-file="/a/s${n}.jsonl"]`)!
    await waitFor(() => expect(row(3)).not.toBeNull())

    drag(row(3), row(1), 'top')

    expect(sessionOrder(container)).toEqual(['/a/s1.jsonl', '/a/s2.jsonl', '/a/s3.jsonl'])
  })

  it('should_move_a_project_and_save_the_order', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await waitFor(() => expect(container.querySelector('[data-workspace="/b"]')).not.toBeNull())
    const header = (path: string) => container.querySelector(`[data-workspace="${path}"] > .nav-row`)!

    drag(header('/b'), header('/a'), 'top')

    await waitFor(() => expect(stored).toEqual(['/b', '/a']))
    await waitFor(() => expect([...container.querySelectorAll('[data-workspace]')].map((row) => row.getAttribute('data-workspace'))).toEqual(['/b', '/a']))
  })

  it('should_not_drop_a_conversation_onto_a_project', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await screen.findByText('chat 3')

    drag(container.querySelector('[data-session-file="/a/s3.jsonl"]')!, container.querySelector('[data-workspace="/b"] > .nav-row')!, 'top')

    expect(mocks.invoke.mock.calls.some(([method]) => method === 'settings.set')).toBe(false)
  })
})
