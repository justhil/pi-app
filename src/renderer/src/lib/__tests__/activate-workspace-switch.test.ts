import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({ ok: true, sessions: [], items: [], totalCount: 0 }) },
}))
vi.mock('@renderer/lib/session-history', () => ({
  fetchSessionHistoryTail: vi.fn().mockResolvedValue({
    items: [
      { id: 'pu1', type: 'user-message', text: 'project q', timestamp: 1 },
      { id: 'pa1', type: 'assistant-message', text: 'project a', timestamp: 2 },
    ],
    totalCount: 2,
  }),
}))
vi.mock('@renderer/lib/session-worker-sync', async () => {
  const actual = await vi.importActual<typeof import('../session-worker-sync')>('../session-worker-sync')
  return {
    ...actual,
    fetchWorkerLiveSnapshot: vi.fn().mockResolvedValue({
      sessionId: null,
      sessionFile: null,
      status: 'idle',
    }),
  }
})
vi.mock('@renderer/lib/session-display-meta', () => ({
  applyComposerDisplayMeta: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@renderer/lib/rewind-metadata', () => ({
  refreshSessionTree: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@renderer/lib/composer-run-display', () => ({
  refreshComposerRunDisplay: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@renderer/lib/workspace-session-choice', () => ({
  chooseWorkspaceSession: vi.fn(() => ({ sessionId: 'p1', sessionFile: '/project/s1.jsonl' })),
}))
vi.mock('@renderer/lib/desktop-alerts', () => ({
  signalDesktopAlert: vi.fn().mockResolvedValue(undefined),
}))

import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { activateWorkspace, switchSessionInPlace } from '../activate-workspace'
import { clearSessionShellForTests, focusSessionSync } from '../session-shell'
import { handleNotificationOpenSession } from '../notification-open-session'
import { fetchSessionHistoryTail } from '../session-history'
import { clearLiveSessionTimeline } from '../live-session-timeline-cache'
import { clearStreamPending, flushStreamPendingSync } from '@renderer/stores/ui-store-stream'
import { ipcClient } from '../ipc-client'
import { beginSessionNavigation, isSessionNavigationCurrent } from '../session-navigation'

const tempItems: TimelineItem[] = [
  { id: 't1', type: 'user-message', text: 'temp hello', timestamp: 1 },
  { id: 't2', type: 'assistant-message', text: 'temp world', timestamp: 2 },
]

describe('workspace/session navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearStreamPending()
    clearLiveSessionTimeline()
    clearSessionShellForTests()
    useUIStore.setState({
      currentWorkspace: null,
      recentProjects: [],
      ephemeralSandboxDraft: true,
      pendingNewSessionPlaceholder: false,
      currentSessionId: '__ephemeral_draft__',
      timelineItems: tempItems.map((i) => ({ ...i })),
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      fileChanges: [],
      historyTotalCount: 0,
      historyLoadedCount: 0,
      historySessionFile: null,
      historyLoading: false,
      sessions: [],
      subagentSessionGroup: null,
      sessionRuntimeRunning: {},
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
    })
  })

  afterEach(() => {
    clearStreamPending()
  })

  it.each(['notification', 'sidebar'] as const)('preserves pending output when %s opens the visible session again', async (source) => {
    const sessionFile = 'D:/project/s1.jsonl'
    useUIStore.setState({
      currentWorkspace: 'D:/project',
      currentSessionId: 'p1',
      historySessionFile: sessionFile,
      ephemeralSandboxDraft: false,
      timelineItems: tempItems.map((item) => ({ ...item })),
      streamingAssistantId: 't2',
      runState: { status: 'running', activeRunId: 'run-1', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'p1', sessionFile, status: 'running' },
      sessionRuntimeRunning: { [sessionFile]: true },
    })
    focusSessionSync('p1', sessionFile)
    useUIStore.getState().addFileChange({ path: 'README.md', source: 'write', changeType: 'modified' })
    const token = beginSessionNavigation()
    const before = useUIStore.getState()
    before.appendDeltaToStreamingAssistant(' pending tail')

    if (source === 'notification') {
      await handleNotificationOpenSession({
        ok: true, workspaceId: 'd:\\project', sessionId: 'p1', sessionFile: 'D:\\project\\s1.jsonl',
      })
    } else {
      await switchSessionInPlace('p1', 'D:\\project\\s1.jsonl')
    }

    expect(isSessionNavigationCurrent(token)).toBe(true)
    expect(fetchSessionHistoryTail).not.toHaveBeenCalled()
    expect(ipcClient.invoke).not.toHaveBeenCalledWith('session.setPendingBind', expect.anything())
    expect(useUIStore.getState().streamingAssistantId).toBe('t2')
    expect(useUIStore.getState().fileChanges).toEqual(before.fileChanges)

    useUIStore.getState().appendDeltaToStreamingAssistant(' continued output')
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
    expect(useUIStore.getState().timelineItems.at(-1)?.text).toBe('temp world pending tail continued output')
  })

  it('continues streaming when a notification returns from another session during history loading', async () => {
    const sessionFile = '/project/s1.jsonl'
    useUIStore.setState({
      currentWorkspace: '/project',
      currentSessionId: 'p1',
      historySessionFile: sessionFile,
      ephemeralSandboxDraft: false,
      streamingAssistantId: 't2',
      runState: { status: 'running', activeRunId: 'run-1', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'p1', sessionFile, status: 'running' },
      sessionRuntimeRunning: { [sessionFile]: true },
    })
    focusSessionSync('p1', sessionFile)
    useUIStore.getState().appendDeltaToStreamingAssistant(' pending tail')
    await switchSessionInPlace('p2', '/project/s2.jsonl')

    let resolveHistory!: (history: Awaited<ReturnType<typeof fetchSessionHistoryTail>>) => void
    vi.mocked(fetchSessionHistoryTail).mockReturnValueOnce(new Promise((resolve) => { resolveHistory = resolve }))
    vi.mocked(ipcClient.invoke).mockClear()
    await handleNotificationOpenSession({ ok: true, workspaceId: '/project', sessionId: 'p1', sessionFile })

    const delta = (text: string, seq: number) => useUIStore.getState().processEvent({
      type: 'message', role: 'assistant', phase: 'delta', contentKind: 'text', text,
      seq, workspaceId: '/project', sessionId: 'p1', sessionFile, runId: 'run-1', timestamp: seq,
    })
    delta(' during history', 1)
    resolveHistory({ items: tempItems, sourceCount: 2, totalCount: 2 })
    await vi.waitFor(() => {
      expect(vi.mocked(ipcClient.invoke).mock.calls.filter(([method]) => method === 'session.setPendingBind')).toHaveLength(2)
    })
    delta(' after history', 2)
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const state = useUIStore.getState()
    expect(state.historySessionFile).toBe(sessionFile)
    expect(state.streamingAssistantId).toBe('t2')
    expect(state.timelineItems.at(-1)?.text).toBe('temp world pending tail during history after history')
    expect(state.runState.status).toBe('running')
  })

  it('explicit pick: temp items are cleared synchronously before any await (no stale flash)', async () => {
    const p = activateWorkspace('/project', { sessionId: 'p1', sessionFile: '/project/s1.jsonl' })

    const s = useUIStore.getState()
    expect(s.currentWorkspace).toBe('/project')
    expect(s.timelineItems).toEqual([])
    expect(s.historyLoading).toBe(true)
    expect(s.historySessionFile).toBe('/project/s1.jsonl')

    await p
    const after = useUIStore.getState()
    expect(after.timelineItems).toHaveLength(2)
    expect(after.historyLoading).toBe(false)
    expect(after.historySessionFile).toBe('/project/s1.jsonl')
  })

  it('switchSessionInPlace: temp items cleared synchronously', async () => {
    useUIStore.setState({ currentWorkspace: '/project' })
    const { switchSessionInPlace } = await import('../activate-workspace')
    const p = switchSessionInPlace('p2', '/project/s2.jsonl')

    const s = useUIStore.getState()
    expect(s.currentWorkspace).toBe('/project')
    expect(s.timelineItems).toEqual([])
    expect(s.historyLoading).toBe(true)
    expect(s.historySessionFile).toBe('/project/s2.jsonl')

    await p
    expect(useUIStore.getState().historyLoading).toBe(false)
  })
})
