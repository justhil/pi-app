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

import { handleRun, shouldSuppressPrematureRunIdle } from '../apply-app-event-run'
import type { StoreApi } from '../apply-app-event-types'
import type { RunState, TimelineItem, UIState } from '../ui-store-types'

const notifyModelFallback = vi.fn()
vi.mock('@renderer/lib/session-display-meta', () => ({
  notifyModelFallback: (...args: unknown[]) => notifyModelFallback(...args),
}))

function makeApi(): {
  api: StoreApi
  state: Record<string, unknown>
} {
  const runState: RunState = {
    status: 'running',
    toolCount: 0,
    errorCount: 0,
    activeRunId: 'run-1',
    startTime: Date.now() - 2000,
  }
  const state: Record<string, unknown> = {
    historySessionFile: '/s.jsonl',
    currentSessionId: 'sid',
    workerLiveSnapshot: { sessionId: 'sid', sessionFile: '/s.jsonl', status: 'running' },
    timelineItems: [
      { id: 'opt-asst-1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 1 },
    ] as TimelineItem[],
    streamingAssistantId: 'opt-asst-1',
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    ignoreQueueSyncUntil: 0,
    runState,
    setRunState: (patch: Partial<RunState>) => {
      state.runState = { ...(state.runState as RunState), ...patch }
    },
    setWorkerLiveSnapshot: (snap: UIState['workerLiveSnapshot']) => {
      state.workerLiveSnapshot = snap
    },
    clearPendingQueue: () => undefined,
    pruneEmptyAssistantBubbles: () => {
      state.timelineItems = (state.timelineItems as TimelineItem[]).filter(
        (i) => !(i.type === 'assistant-message' && !i.text?.trim() && !i.thinkingText?.trim()),
      )
    },
  }
  return {
    state,
    api: {
      get: () => state as unknown as UIState,
      set: (partial) => Object.assign(state, partial),
      nextItemId: () => 'n1',
    },
  }
}

describe('shouldSuppressPrematureRunIdle', () => {
  it('does not suppress when worker already bound a run id', () => {
    expect(
      shouldSuppressPrematureRunIdle({
        optimisticPendingUserText: 'hi',
        agentTurnBootstrapping: true,
        runState: { status: 'running', activeRunId: 'run-1' },
      }),
    ).toBe(false)
  })

  it('suppresses only local bootstrap before any worker run id', () => {
    expect(
      shouldSuppressPrematureRunIdle({
        optimisticPendingUserText: 'hi',
        agentTurnBootstrapping: false,
        runState: { status: 'running' },
      }),
    ).toBe(true)
  })

  it('never suppresses solely because of empty opt-asst bubbles', () => {
    expect(
      shouldSuppressPrematureRunIdle({
        optimisticPendingUserText: null,
        agentTurnBootstrapping: false,
        runState: { status: 'running', activeRunId: 'run-1' },
      }),
    ).toBe(false)
  })
})

describe('handleRun idle (agent completion)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears running UI even when empty optimistic assistant remains', () => {
    const { api, state } = makeApi()
    handleRun(
      {
        type: 'run',
        phase: 'idle',
        seq: 2,
        workspaceId: '/w',
        sessionFile: '/s.jsonl',
        runId: 'run-1',
        timestamp: Date.now(),
      } as never,
      api,
    )

    expect((state.runState as RunState).status).toBe('idle')
    expect(state.streamingAssistantId).toBeNull()
    expect((state.workerLiveSnapshot as { status: string }).status).toBe('idle')
  })

  it('run.state applies runtime model and surfaces modelFallbackMessage', async () => {
    notifyModelFallback.mockClear()
    const { api, state } = makeApi()
    ;(state.runState as RunState).model = 'custom/gpt-5.6-terra'
    handleRun(
      {
        type: 'run',
        phase: 'state',
        seq: 3,
        workspaceId: '/w',
        sessionFile: '/s.jsonl',
        model: 'anthropic/claude-opus-4-8',
        thinkingLevel: 'high',
        modelFallbackMessage: 'Could not restore model custom/gpt-5.6-terra. Using anthropic/claude-opus-4-8',
        timestamp: Date.now(),
      } as never,
      api,
    )

    expect((state.runState as RunState).model).toBe('anthropic/claude-opus-4-8')
    expect((state.runState as RunState).thinkingLevel).toBe('high')
    await vi.waitFor(() => {
      expect(notifyModelFallback).toHaveBeenCalled()
    })
  })
})
