import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './status-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import { useBackgroundTasksStore } from '@renderer/stores/background-tasks-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), activate: vi.fn(), switchSession: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onAppUpdateAvailable: () => () => {},
  onGitWorkspaceChanged: () => () => {},
  onAppEvent: () => () => {},
}))
vi.mock('@renderer/lib/activate-workspace', () => ({ activateWorkspace: mocks.activate, switchSessionInPlace: mocks.switchSession }))
vi.mock('@renderer/features/git/branch-status', () => ({ BranchStatusTrigger: () => null }))
vi.mock('@renderer/features/terminal/terminal-drawer', () => ({ openTerminalTab: vi.fn() }))

const workspace = '\\\\wsl.localhost\\Ubuntu\\home\\user\\project-b'
const file = '\\\\wsl.localhost\\Ubuntu\\home\\user\\.pi\\agent\\sessions\\background.jsonl'
const session = { sessionId: 'background', sessionFile: file, workspaceId: workspace, title: 'Background task', modelId: '', updatedAt: 1 }
const foreground = { sessionId: 'foreground', sessionFile: '/sessions/foreground.jsonl', title: 'Foreground task', modelId: '', updatedAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  __resetRefreshWorkspaceSessionListsForTests()
  useUIStore.setState({ currentWorkspace: '/project-a', sessions: [foreground], sessionAttention: { [file]: 'working' } })
  useBackgroundTasksStore.setState({ tasksBySession: {}, activeAdapterBySession: {}, loading: false })
  mocks.invoke.mockImplementation(async (channel) => {
    if (channel === 'desktop.status') return { rss: 256 * 1024 ** 2, total: 16 * 1024 ** 3, workers: [{ sessionFile: file, cwd: workspace, running: true }] }
    if (channel === 'session.list') return { sessions: [session] }
    if (channel === 'session.prepare') return { sessionId: session.sessionId, sessionFile: file, workspaceId: workspace }
    return { ok: true }
  })
})
afterEach(cleanup)

describe('StatusBar without duplicate bottom session board', () => {
  it('omits the duplicate session-activity trigger while still managing sleep block', async () => {
    render(<StatusBar />)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop.setSleepBlock', { on: true }))
    expect(screen.queryByRole('button', { name: 'Session activity' })).toBeNull()
  })

  it('loads background project titles lazily when opening the resources popover', async () => {
    render(<StatusBar />)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop.status', {}))
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'session.list')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Runtime & resources' }))
    expect(await screen.findByText('Background task')).toBeInTheDocument()
    expect(useUIStore.getState().sessions).toEqual([foreground])
  })
})
