import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@renderer/stores/ui-store-stream', () => ({
  flushStreamPendingSync: vi.fn(),
  clearStreamPending: vi.fn(),
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
import { activateWorkspace } from '../activate-workspace'
import { clearSessionShellForTests } from '../session-shell'

const tempItems: TimelineItem[] = [
  { id: 't1', type: 'user-message', text: 'temp hello', timestamp: 1 },
  { id: 't2', type: 'assistant-message', text: 'temp world', timestamp: 2 },
]

describe('activate-workspace sandbox->project switch', () => {
  beforeEach(() => {
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
