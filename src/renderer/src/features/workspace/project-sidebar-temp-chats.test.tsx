import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'
import { ProjectSidebar } from './project-sidebar'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/activate-workspace', () => ({ activateWorkspace: vi.fn(), switchSessionInPlace: vi.fn(), previewSessionInPlace: vi.fn() }))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({ useToolCardCatalogReady: () => true }))

const SANDBOXES = 'C:/Users/me/AppData/Roaming/pi-desktop/sandbox-workspaces'
const older = { path: `${SANDBOXES}/old1`, label: 'older chat', sessionId: 's-old', sessionFile: `${SANDBOXES}/old1/s.jsonl` }

beforeEach(() => {
  __resetRefreshWorkspaceSessionListsForTests()
  mocks.invoke.mockReset()
  // The user last folded the temp chats away: they only open because the app starts in a temp-chat draft.
  localStorage.setItem('pi-desktop:sidebar-temp-chats-open', '0')
  useUIStore.setState({ currentWorkspace: null, recentProjects: ['/project'], sessions: [], sessionsWorkspace: null,
    currentSessionId: null, historySessionFile: null, timelineItems: [], subagentSessionGroup: null,
    sessionAttention: {}, sidebarCollapsed: false, ephemeralSandboxDraft: true,
  })
  mocks.invoke.mockImplementation(async (method: string) => {
    if (method === 'settings.get') return { settings: { recentProjects: ['/project'], recentProjectsFixedOrder: true } }
    if (method === 'desktop.gitWorktrees') return { ok: true, trees: [], repositoryPath: null }
    // The sandbox just created for the first message is not listed yet: it has no bound session file.
    if (method === 'workspace.sandbox.list') return { sandboxes: [older] }
    if (method === 'session.list') return { sessions: [] }
    return { ok: true }
  })
})

function tempChatsToggle(container: HTMLElement): HTMLElement {
  return container.querySelector('.sidebar-section-hit[aria-expanded]') as HTMLElement
}

describe('temp chats section', () => {
  it('should_stay_open_when_the_first_message_moves_a_draft_into_a_sandbox_not_listed_yet', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await waitFor(() => expect(tempChatsToggle(container).getAttribute('aria-expanded')).toBe('true'))

    // finalizeEphemeralSandboxOnFirstSend: the draft ends and the view moves into the new sandbox.
    act(() => useUIStore.setState({ ephemeralSandboxDraft: false, currentWorkspace: `${SANDBOXES}/new1` }))

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(tempChatsToggle(container).getAttribute('aria-expanded')).toBe('true')
  })

  it('should_fold_back_when_the_conversation_moves_to_a_project', async () => {
    const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="Open folder" />)
    await waitFor(() => expect(tempChatsToggle(container).getAttribute('aria-expanded')).toBe('true'))

    act(() => useUIStore.setState({ ephemeralSandboxDraft: false, currentWorkspace: '/project' }))

    await waitFor(() => expect(tempChatsToggle(container).getAttribute('aria-expanded')).toBe('false'))
  })
})
