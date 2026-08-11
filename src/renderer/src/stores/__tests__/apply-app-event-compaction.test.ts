import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/desktop-alerts', () => ({
  signalDesktopAlert: vi.fn(),
}))
vi.mock('@renderer/lib/alert-trace', () => ({
  alertTrace: vi.fn(),
}))
vi.mock('@renderer/lib/abort-ui-hold', () => ({
  isAbortUiHoldActive: () => false,
}))
vi.mock('@renderer/lib/extension-ui-tool-sync', () => ({
  reconcileAllStaleInteractiveToolRows: vi.fn(),
}))
vi.mock('@renderer/stores/ui-store-stream', () => ({
  flushStreamPendingSync: vi.fn(),
}))
vi.mock('@renderer/lib/extension-ui-channel', () => ({
  clearExtensionDialogDedupe: vi.fn(),
}))
vi.mock('@renderer/stores/extension-ui-store', () => ({
  useExtensionUIStore: { getState: () => ({ clearAfterRespond: vi.fn() }) },
}))

import { handleCompaction } from '../apply-app-event-compaction'
import { handleRun } from '../apply-app-event-run'
import { applyBackgroundAppEvent } from '../apply-app-event-background'
import { useUIStore } from '@renderer/stores/ui-store'
import type { StoreApi } from '../apply-app-event-types'
import type { CompactionEvent } from '../apply-app-event-types'

function makeApi(): { api: StoreApi; state: Record<string, unknown> } {
  const state: Record<string, unknown> = {
    compactingSessions: {},
    setCompactingSession: (sessionFile: string | null, active: boolean) => {
      useUIStore.getState().setCompactingSession(sessionFile, active)
    },
    appendTimeline: () => undefined,
    runState: { status: 'running', activeRunId: 'run-1', startTime: Date.now() - 2000 },
    setRunState: (patch: Record<string, unknown>) => {
      state.runState = { ...(state.runState as Record<string, unknown>), ...patch }
    },
    setWorkerLiveSnapshot: (snap: unknown) => {
      state.workerLiveSnapshot = snap
    },
    clearPendingQueue: () => undefined,
    pruneEmptyAssistantBubbles: () => undefined,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    historySessionFile: '/s.jsonl',
    currentSessionId: 'sid',
    workerLiveSnapshot: { sessionId: 'sid', sessionFile: '/s.jsonl', status: 'running' },
  }
  return {
    api: {
      get: () => state as never,
      set: (patch: unknown) => Object.assign(state, patch),
      nextItemId: () => 'item-1',
    } as unknown as StoreApi,
    state,
  }
}

function compactionEvent(phase: 'start' | 'end', summary?: string, sessionFile = '/s.jsonl'): CompactionEvent {
  return {
    type: 'compaction',
    phase,
    summary,
    sessionFile,
    timestamp: Date.now(),
  } as CompactionEvent
}

describe('handleCompaction per-session state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ compactingSessions: {} })
  })

  it('sets the compaction flag for the event session and clears it on end', () => {
    const { api } = makeApi()

    handleCompaction(compactionEvent('start'), api)
    expect(useUIStore.getState().compactingSessions['/s.jsonl']).toBe(true)

    handleCompaction(compactionEvent('end', 'summary text'), api)
    expect(useUIStore.getState().compactingSessions['/s.jsonl']).toBe(false)
  })

  it('isolates compaction state per session', () => {
    const { api } = makeApi()

    handleCompaction(compactionEvent('start', undefined, '/a.jsonl'), api)
    // B 从未压缩：不得显示压缩中
    expect(useUIStore.getState().compactingSessions['/b.jsonl']).toBeUndefined()
    // A 的 end 只清 A，不影响 B
    handleCompaction(compactionEvent('end', undefined, '/a.jsonl'), api)
    expect(useUIStore.getState().compactingSessions['/a.jsonl']).toBe(false)
  })

  it('background compaction events keep the session flag in sync', () => {
    const { api } = makeApi()
    // A 在前台开始压缩后用户切到 B：A 的 start/end 都走后台路由
    applyBackgroundAppEvent(compactionEvent('start', undefined, '/a.jsonl'))
    expect(useUIStore.getState().compactingSessions['/a.jsonl']).toBe(true)

    applyBackgroundAppEvent(compactionEvent('end', undefined, '/a.jsonl'))
    expect(useUIStore.getState().compactingSessions['/a.jsonl']).toBe(false)
  })

  it('run idle clears a stale compaction flag after a lost compaction_end', () => {
    const { api } = makeApi()

    handleCompaction(compactionEvent('start'), api)
    expect(useUIStore.getState().compactingSessions['/s.jsonl']).toBe(true)

    // Worker crashed mid-compaction: no compaction_end arrives. A later run idle
    // (next turn / reconnect) must clear the stale badge for this session.
    handleRun(
      {
        type: 'run',
        phase: 'idle',
        runId: 'run-1',
        sessionFile: '/s.jsonl',
        timestamp: Date.now(),
      } as never,
      api,
    )
    expect(useUIStore.getState().compactingSessions['/s.jsonl']).toBe(false)
  })
})
