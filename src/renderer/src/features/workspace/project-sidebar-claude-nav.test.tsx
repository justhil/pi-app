import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { ProjectSidebar } from './project-sidebar'
import { ComposerProjectPicker } from '@renderer/features/composer/composer-project-picker'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), activate: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: mocks.activate,
  switchSessionInPlace: vi.fn(),
  previewSessionInPlace: vi.fn(),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

beforeEach(() => {
  __resetRefreshWorkspaceSessionListsForTests()
  mocks.invoke.mockReset()
  mocks.activate.mockReset()
  useUIStore.setState({
    currentWorkspace: '/proj-a',
    recentProjects: ['/proj-a', '/proj-b'],
    projectDisplayNames: {},
    sessions: [],
    sessionsWorkspace: '/proj-a',
    currentSessionId: null,
    historySessionFile: null,
    timelineItems: [],
    subagentSessionGroup: null,
    sessionAttention: {},
    sidebarCollapsed: false,
    ephemeralSandboxDraft: false,
    pendingNewSessionPlaceholder: true,
  })
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'settings.get') {
      return { settings: { recentProjects: ['/proj-a', '/proj-b'], recentProjectsFixedOrder: true } }
    }
    if (method === 'desktop.gitWorktrees') return { ok: true, trees: [], repositoryPath: null }
    if (method === 'workspace.sandbox.list') return { sandboxes: [] }
    if (method === 'session.list') return { sessions: [] }
    return { ok: true }
  })
})

describe('Claude-style top sidebar nav & project picker', () => {
  it('shows New and Plugins rows, highlights New on blank chat, and omits pending session row', async () => {
    const onSelectPage = vi.fn()
    const { container } = render(
      <ProjectSidebar
        onOpenProject={() => {}}
        openProjectLabel="Open folder"
        activeMainPage="chat"
        onSelectMainPage={onSelectPage}
      />,
    )

    const newBtn = screen.getByRole('button', { name: 'New' })
    const pluginsBtn = screen.getByRole('button', { name: 'Plugins' })
    expect(newBtn).toHaveAttribute('aria-current', 'page')
    expect(pluginsBtn).not.toHaveAttribute('aria-current')
    expect(container.querySelector('.sidebar-pending-row')).toBeNull()

    fireEvent.click(pluginsBtn)
    expect(onSelectPage).toHaveBeenCalledWith('plugins')

    fireEvent.click(newBtn)
    await waitFor(() => expect(useUIStore.getState().ephemeralSandboxDraft).toBe(true))
    expect(useUIStore.getState().currentWorkspace).toBeNull()
  })

  it('switches between No project and disk projects from ComposerProjectPicker', () => {
    render(<ComposerProjectPicker />)
    const trigger = screen.getByRole('button', { name: 'Select project for chat' })
    expect(trigger).toHaveTextContent('proj-a')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: /No project/ }))
    expect(useUIStore.getState().ephemeralSandboxDraft).toBe(true)
    expect(trigger).toHaveTextContent('No project')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'proj-b' }))
    expect(mocks.activate).toHaveBeenCalledWith('/proj-b', { preferHome: true })
  })
})
