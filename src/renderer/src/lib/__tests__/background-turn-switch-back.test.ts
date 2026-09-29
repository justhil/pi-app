import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMock = vi.hoisted(() => ({
  disk: new Map<string, unknown[]>(),
  invoke: vi.fn().mockResolvedValue({}),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: ipcMock.invoke },
}))
vi.mock('@renderer/lib/session-display-meta', () => ({
  applyComposerDisplayMeta: vi.fn().mockResolvedValue(undefined),
}))

import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { clearLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import { clearSessionHistoryCache, fetchSessionHistoryTail } from '@renderer/lib/session-history'
import {
  clearSessionShellForTests,
  focusSession,
  focusSessionSync,
} from '@renderer/lib/session-shell'
import { applyBackgroundAppEvent } from '@renderer/stores/apply-app-event-background'
import { clearStreamPending } from '@renderer/stores/ui-store-stream'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

// Windows-style paths: renderer keys are normalized (forward slashes), callers often pass raw paths.
const sessionA = 'C:\\sessions\\a.jsonl'
const sessionAKey = 'C:/sessions/a.jsonl'
const sessionB = 'C:\\sessions\\b.jsonl'

function diskRows(sessionFile: string, rows: TimelineItem[]): void {
  ipcMock.disk.set(sessionFile, rows)
}

const history: TimelineItem[] = [
  { id: 'hist-1', type: 'user-message', text: 'first', sessionEntryId: 'e-u1', timestamp: 1 },
  { id: 'hist-2', type: 'assistant-message', text: 'first answer', sessionEntryId: 'e-a1', timestamp: 2 },
  { id: 'hist-3', type: 'user-message', text: 'run the long bash', sessionEntryId: 'e-u2', timestamp: 3 },
]

describe('#99 background turn completion → switch back', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    ipcMock.disk.clear()
    ipcMock.invoke.mockReset()
    ipcMock.invoke.mockImplementation(async (method: string, req?: { sessionFile?: string }) => {
      if (method === 'session.getMessages') {
        const key = String(req?.sessionFile || '').replace(/\\/g, '/')
        const items = ipcMock.disk.get(key) ?? []
        return { items, sourceCount: items.length, totalCount: items.length }
      }
      return {}
    })
    clearStreamPending()
    clearLiveSessionTimeline()
    clearSessionShellForTests()
    clearSessionHistoryCache()
  })

  it('should_show_disk_result_when_live_cache_missed_background_rows', async () => {
    // A is mid-turn and visible: streaming assistant has no persisted identity yet.
    useUIStore.setState({
      currentWorkspace: 'C:/workspace',
      currentSessionId: 'session-a',
      historySessionFile: sessionAKey,
      historyTotalCount: 3,
      historyLoadedCount: 3,
      historyLoading: false,
      timelineItems: [
        ...history,
        { id: 'live-asst', type: 'assistant-message', text: 'working…', timestamp: 4 },
      ],
      streamingAssistantId: 'live-asst',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { [sessionAKey]: true },
      runState: { status: 'running', activeRunId: 'run-a', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'session-a', sessionFile: sessionAKey, status: 'running' },
      fileChanges: [],
    })

    // Switch A → B while A keeps running.
    captureVisibleLiveSessionTimeline()
    diskRows('C:/sessions/b.jsonl', [])
    focusSessionSync('session-b', sessionB)

    // A finishes in the background; only the terminal run event reaches the live cache.
    applyBackgroundAppEvent({
      type: 'run',
      phase: 'idle',
      seq: 10,
      workspaceId: 'C:/workspace',
      sessionFile: sessionAKey,
      timestamp: 10,
    })
    diskRows(sessionAKey, [
      ...history,
      { id: 'hist-4', type: 'assistant-message', text: 'final answer', sessionEntryId: 'e-a2', timestamp: 5 },
    ])

    await focusSession('session-a', sessionA)

    const texts = useUIStore.getState().timelineItems.map((item) => item.text)
    expect(texts).toContain('final answer')
    expect(texts).not.toContain('working…')
    expect(useUIStore.getState().streamingAssistantId).toBeNull()
  })

  it('should_not_resurrect_stale_capture_on_second_switch_back', async () => {
    useUIStore.setState({
      currentWorkspace: 'C:/workspace',
      currentSessionId: 'session-a',
      historySessionFile: sessionAKey,
      timelineItems: [
        ...history,
        { id: 'live-asst', type: 'assistant-message', text: 'working…', timestamp: 4 },
      ],
      streamingAssistantId: 'live-asst',
      sessionRuntimeRunning: { [sessionAKey]: true },
      runState: { status: 'running', activeRunId: 'run-a', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'session-a', sessionFile: sessionAKey, status: 'running' },
    })
    captureVisibleLiveSessionTimeline()
    diskRows('C:/sessions/b.jsonl', [])
    focusSessionSync('session-b', sessionB)
    applyBackgroundAppEvent({
      type: 'run',
      phase: 'idle',
      seq: 10,
      workspaceId: 'C:/workspace',
      sessionFile: sessionAKey,
      timestamp: 10,
    })
    diskRows(sessionAKey, [
      ...history,
      { id: 'hist-4', type: 'assistant-message', text: 'final answer', sessionEntryId: 'e-a2', timestamp: 5 },
    ])
    await focusSession('session-a', sessionA)

    // Leave and come back again: the instant (cache) paint must already be the disk result.
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)

    const texts = useUIStore.getState().timelineItems.map((item) => item.text)
    expect(texts).toContain('final answer')
    expect(texts).not.toContain('working…')
  })

  it('should_invalidate_slice_cache_for_raw_windows_path', async () => {
    diskRows(sessionAKey, history.slice(0, 2))
    await fetchSessionHistoryTail(sessionAKey, 80)
    diskRows(sessionAKey, history)

    // Callers pass the raw backslash path; the cache stores normalized keys.
    clearSessionHistoryCache(sessionA)
    const fresh = await fetchSessionHistoryTail(sessionAKey, 80)

    expect(fresh.items).toHaveLength(3)
  })
})
