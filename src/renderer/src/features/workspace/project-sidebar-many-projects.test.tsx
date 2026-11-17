import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { workspacePathsEqual } from '@shared/workspace-path'
import { ProjectSidebar } from './project-sidebar'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  activate: vi.fn(async () => {}),
  recentProjects: [] as string[],
  fixedOrder: true,
}))

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: mocks.activate,
  switchSessionInPlace: vi.fn(),
  previewSessionInPlace: vi.fn(),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

function makeProjects(count: number): string[] {
  return Array.from({ length: count }, (_, idx) => `/proj/p${String(idx + 1).padStart(2, '0')}`)
}

describe('ProjectSidebar with >10 / >16 projects and removal (#141, #143)', () => {
  beforeEach(() => {
    __resetRefreshWorkspaceSessionListsForTests()
    mocks.invoke.mockReset()
    mocks.activate.mockClear()
    mocks.recentProjects = makeProjects(25)
    mocks.fixedOrder = true

    useUIStore.setState({
      currentWorkspace: '/proj/p01',
      recentProjects: [],
      projectDisplayNames: {},
      sessions: [],
      sessionsWorkspace: null,
      currentSessionId: null,
      historySessionFile: null,
      timelineItems: [],
      subagentSessionGroup: null,
      sessionAttention: {},
      sidebarCollapsed: false,
      ephemeralSandboxDraft: false,
    })

    mocks.invoke.mockImplementation(async (method: string, req?: Record<string, unknown>) => {
      if (method === 'settings.get' && req?.key === 'recentProjects') {
        return { settings: { recentProjects: mocks.recentProjects } }
      }
      if (method === 'settings.get' && req?.key === 'recentProjectsFixedOrder') {
        return { settings: { recentProjectsFixedOrder: mocks.fixedOrder } }
      }
      if (method === 'settings.get' && req?.key === 'projectDisplayNames') {
        return { settings: { projectDisplayNames: {} } }
      }
      if (method === 'desktop.gitWorktrees') {
        return { ok: true, repositoryPath: null, trees: [] }
      }
      if (method === 'workspace.sandbox.list') {
        return { sandboxes: [] }
      }
      if (method === 'session.list') {
        return { sessions: [] }
      }
      if (method === 'project.removeRecent') {
        const target = String(req?.path || '')
        mocks.recentProjects = mocks.recentProjects.filter((p) => !workspacePathsEqual(p, target))
        return { ok: true, currentProject: '/proj/p01', recentProjects: mocks.recentProjects }
      }
      return { ok: true }
    })
  })

  it('renders all 25 projects in fixed order without dropping entries at 10 or 16', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)

    await waitFor(() => {
      expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(25)
    })

    const workspaces = [...container.querySelectorAll('.sidebar-project-row')].map((el) =>
      el.getAttribute('data-workspace'),
    )
    expect(workspaces).toEqual(makeProjects(25))
  })

  it('renders all 25 projects in MRU order without dropping entries at 10 or 16', async () => {
    mocks.fixedOrder = false
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)

    await waitFor(() => {
      expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(25)
    })

    const workspaces = [...container.querySelectorAll('.sidebar-project-row')].map((el) =>
      el.getAttribute('data-workspace'),
    )
    expect(workspaces).toEqual(makeProjects(25))
  })

  it('removes a project via context menu confirmation and keeps remaining 24 entries', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)

    await waitFor(() => {
      expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(25)
    })

    const row = container.querySelector('[data-workspace="/proj/p02"]')!
    fireEvent.contextMenu(row, { clientX: 24, clientY: 24 })

    const removeItem = await screen.findByRole('button', { name: 'Remove from list' })
    fireEvent.click(removeItem)

    const confirmBtn = await screen.findByRole('button', { name: 'OK' })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(container.querySelectorAll('.sidebar-project-row')).toHaveLength(24)
    })
    expect(container.querySelector('[data-workspace="/proj/p02"]')).toBeNull()
    expect(mocks.invoke).toHaveBeenCalledWith(
      'project.removeRecent',
      expect.objectContaining({ path: '/proj/p02' }),
    )
  })
})
