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

  it.each(['working', 'needs-you', 'done'] as const)('recovers a %s title from the session file after its worker disappears', async (attention) => {
    const invoke = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (channel, args) => channel === 'desktop.status'
      ? { rss: 0, total: 0, workers: [] } : invoke(channel, args))
    useUIStore.setState({ sessionAttention: { [file.replace(/\\/g, '/')]: attention } })

    render(<StatusBar />)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop.status', {}))
    expect(mocks.invoke.mock.calls.some(([channel]) => channel === 'session.prepare' || channel === 'session.list')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    const row = await screen.findByRole('button', { name: /Background task/ })
    expect(mocks.invoke).toHaveBeenCalledWith('session.prepare', { sessionFile: file.replace(/\\/g, '/'), bind: false })
    expect(mocks.invoke).toHaveBeenCalledWith('session.list', { workspaceId: workspace, refresh: true })
    expect(useUIStore.getState().sessions).toEqual([foreground])
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(mocks.switchSession).not.toHaveBeenCalled()

    fireEvent.click(row)
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith(workspace, { sessionId: session.sessionId, sessionFile: file }))
  })

  it('loads a title when a session without a worker enters the open activity list', async () => {
    const invoke = mocks.invoke.getMockImplementation()!
    mocks.invoke.mockImplementation(async (channel, args) => channel === 'desktop.status'
      ? { rss: 0, total: 0, workers: [] } : invoke(channel, args))
    useUIStore.setState({ sessionAttention: { [foreground.sessionFile]: 'working' } })

    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    await screen.findByRole('button', { name: /Foreground task/ })
    act(() => useUIStore.setState({ sessionAttention: { [foreground.sessionFile]: 'working', [file]: 'done' } }))
    expect(await screen.findByRole('button', { name: /Background task/ })).toBeEnabled()
    expect(useUIStore.getState().sessions).toEqual([foreground])
  })

  it('loads a shared project once for sessions without workers', async () => {
    const siblingFile = file.replace('background.jsonl', 'sibling.jsonl')
    const sibling = { ...session, sessionId: 'sibling', sessionFile: siblingFile, title: 'Sibling task' }
    useUIStore.setState({ sessionAttention: { [file]: 'done', [siblingFile]: 'done' } })
    mocks.invoke.mockImplementation(async (channel, args) => {
      if (channel === 'desktop.status') return { rss: 0, total: 0, workers: [] }
      if (channel === 'session.prepare') return { sessionId: args.sessionFile.includes('sibling') ? sibling.sessionId : session.sessionId, workspaceId: workspace }
      if (channel === 'session.list') return { sessions: [session, sibling] }
      return {}
    })

    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    expect(await screen.findByRole('button', { name: /Background task/ })).toBeEnabled()
    expect(await screen.findByRole('button', { name: /Sibling task/ })).toBeEnabled()
    expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'session.list')).toHaveLength(1)
    expect(useUIStore.getState().sessions).toEqual([foreground])
  })

  it.each(['fails', 'stalls'])('still loads a live session title when another session lookup %s', async (outcome) => {
    const missingFile = '/sessions/missing.jsonl'
    const invoke = mocks.invoke.getMockImplementation()!
    useUIStore.setState({ sessionAttention: { [file]: 'working', [missingFile]: 'done' } })
    mocks.invoke.mockImplementation(async (channel, args) => {
      if (channel === 'session.prepare' && args.sessionFile === missingFile) {
        if (outcome === 'stalls') return new Promise(() => {})
        throw new Error('read failed')
      }
      return invoke(channel, args)
    })

    render(<StatusBar />)
    fireEvent.click(screen.getByRole('button', { name: 'Session activity' }))
    expect(await screen.findByRole('button', { name: /Background task/ })).toBeEnabled()
    expect(mocks.invoke).toHaveBeenCalledWith('session.prepare', { sessionFile: missingFile, bind: false })
    expect(screen.queryByRole('alert')).toBeNull()
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

describe('today usage', () => {
  const bucket = (cost: number, calls: number, tokens = 0) => ({ input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost, calls })
  const summary = {
    from: 0,
    to: 1,
    total: bucket(0.49, 436, 39_200_000),
    cacheHitRate: 0.94,
    activeDays: 1,
    sessions: 4,
    firstAt: null,
    byDay: [],
    heat: { calls: [], cost: [], tokens: [] },
    byModel: [
      { model: 'deepseek/deepseek-v4.1-flash', ...bucket(0.49, 436, 39_200_000) },
      { model: 'anthropic/claude-sonnet-5', ...bucket(0.31, 12, 1_500_000) },
    ],
    byProject: [],
    topSessions: [],
  }

  it('keeps the money metric visible and opens the per-model breakdown', async () => {
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === 'usage.summary') return summary
      if (channel === 'desktop.status') return { rss: 0, total: 0, workers: [] }
      return {}
    })
    render(<StatusBar />)
    const chip = screen.getByRole('button', { name: "Today's usage" })
    await waitFor(() => expect(chip).toHaveTextContent('$0.49'))
    expect(chip).toHaveTextContent('39.2M')
    expect(mocks.invoke).toHaveBeenCalledWith('usage.summary', { days: 1 })

    fireEvent.click(chip)
    expect(await screen.findByText('deepseek-v4.1-flash')).toBeInTheDocument()
    expect(screen.getByText(/deepseek · 39.2M tokens/)).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument()
    expect(screen.getByText('94%')).toBeInTheDocument()
  })

  it('shows a placeholder until the first reading and keeps the chip usable on failure', async () => {
    mocks.invoke.mockRejectedValue(new Error('scan failed'))
    render(<StatusBar />)
    const chip = screen.getByRole('button', { name: "Today's usage" })
    expect(chip).toHaveTextContent('—')
    fireEvent.click(chip)
    expect(await screen.findByRole('alert')).toHaveTextContent('Usage is unavailable right now.')
  })
})
