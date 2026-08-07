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
import type { StoreApi } from '../apply-app-event-types'
import type { CompactionEvent } from '../apply-app-event-types'

function makeApi(): { api: StoreApi; state: Record<string, unknown> } {
  const state: Record<string, unknown> = {
    compactionActive: false,
    setCompactionActive: (active: boolean) => {
      state.compactionActive = active
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

function compactionEvent(phase: 'start' | 'end', summary?: string): CompactionEvent {
  return {
    type: 'compaction',
    phase,
    summary,
    timestamp: Date.now(),
  } as CompactionEvent
}

describe('handleCompaction compactionActive state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets compactionActive on start and clears it on end', () => {
    const { api, state } = makeApi()

    handleCompaction(compactionEvent('start'), api)
    expect(state.compactionActive).toBe(true)

    handleCompaction(compactionEvent('end', 'summary text'), api)
    expect(state.compactionActive).toBe(false)
  })

  it('run idle clears a stale compactionActive after a lost compaction_end', () => {
    const { api, state } = makeApi()

    handleCompaction(compactionEvent('start'), api)
    expect(state.compactionActive).toBe(true)

    // Worker crashed mid-compaction: no compaction_end arrives. A later run idle
    // (next turn / reconnect) must clear the stale badge.
    handleRun(
      {
        type: 'run',
        phase: 'idle',
        runId: 'run-1',
        timestamp: Date.now(),
      } as never,
      api,
    )
    expect(state.compactionActive).toBe(false)
  })
})
