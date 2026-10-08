import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from './status-bar'
import { useUIStore } from '@renderer/stores/ui-store'
import { __resetRefreshWorkspaceSessionListsForTests } from '@renderer/lib/refresh-workspace-session-lists'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), activate: vi.fn(), switchSession: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onAppUpdateAvailable: () => () => {},
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
  mocks.invoke.mockImplementation(async (channel) => {
    if (channel === 'desktop.status') return { rss: 0, total: 0, workers: [{ sessionFile: file, cwd: workspace, running: true }] }
    if (channel === 'session.list') return { sessions: [session] }
    if (channel === 'session.prepare') return { sessionId: session.sessionId, sessionFile: file, workspaceId: workspace }
    return {}
  })
})
afterEach(cleanup)

async function openBoard() {
  render(<StatusBar />)
  fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
  return screen.findByRole('button', { name: /Background task/ })
}

describe('session activity', () => {
  it('loads background project titles only while open and keeps the foreground list', async () => {
    render(<StatusBar />)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop.status', {}))
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'session.list')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    expect(await screen.findByRole('button', { name: /Background task/ })).toBeEnabled()
    expect(screen.queryByText('background.jsonl')).toBeNull()
    expect(useUIStore.getState().sessions).toEqual([foreground])
  })

  it('opens a background session using its actual project and file identity', async () => {
    fireEvent.click(await openBoard())
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(workspace, { sessionId: 'background', sessionFile: file }))
    expect(mocks.invoke).toHaveBeenCalledWith('session.prepare', { sessionFile: file, bind: false })
    expect(mocks.switchSession).not.toHaveBeenCalled()
  })

  it('opens an existing file even when it is absent from project lists and workers', async () => {
    const invoke = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (channel, args) => channel === 'session.list' ? { sessions: [] }
      : channel === 'desktop.status' ? { rss: 0, total: 0, workers: [] } : invoke(channel, args))
    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Untitled session' }))
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(workspace, { sessionId: 'background', sessionFile: file }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('switches within the current project using normalized workspace paths', async () => {
    useUIStore.setState({ currentWorkspace: workspace.replace(/\\/g, '/'), sessions: [session] })
    fireEvent.click(await openBoard())
    await waitFor(() => expect(mocks.switchSession).toHaveBeenCalledWith('background', file))
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('reports deletion only when the file cannot be prepared', async () => {
    const row = await openBoard()
    mocks.invoke.mockResolvedValue({ sessionId: null })
    fireEvent.click(row)
    expect(await screen.findByRole('alert')).toHaveTextContent('This session was deleted or is unavailable')
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('reports a lookup failure separately from deletion', async () => {
    const row = await openBoard()
    mocks.invoke.mockRejectedValue(new Error('read failed'))
    await act(async () => fireEvent.click(row))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open that session')
    expect(mocks.activate).not.toHaveBeenCalled()
  })
})
