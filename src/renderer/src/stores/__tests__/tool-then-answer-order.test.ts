import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { clearStreamPending, flushStreamPendingSync } from '../ui-store-stream'
import { useUIStore } from '../ui-store'

const base = { runId: 'run-1', workspaceId: '/workspace', sessionFile: '/workspace/session.jsonl' }
let seq = 0
const ev = (event: Record<string, unknown>): AppEvent =>
  ({ ...base, seq: ++seq, timestamp: seq, ...event }) as unknown as AppEvent

describe('tool-only step followed by the final answer', () => {
  beforeEach(() => {
    seq = 0
    clearStreamPending()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-1',
      historySessionFile: '/workspace/session.jsonl',
      historyLoading: false,
      timelineItems: [
        { id: 'opt-user-1', type: 'user-message', text: 'run two commands', timestamp: 0, sessionEntryId: 'u1' },
        { id: 'opt-asst-1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 0 },
      ],
      streamingAssistantId: 'opt-asst-1',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { '/workspace/session.jsonl': true },
      workerLiveSnapshot: { sessionId: 'session-1', sessionFile: '/workspace/session.jsonl', status: 'running' },
      runState: { status: 'running', activeRunId: 'run-1', toolCount: 0, errorCount: 0 },
    })
  })

  afterEach(() => {
    clearStreamPending()
    vi.unstubAllGlobals()
  })

  it('appends the answer after the tools instead of reusing the leading empty bubble', () => {
    const store = useUIStore.getState()
    // Step 1: assistant message that only calls tools (no prose), persisted as a1.
    store.processEvent(ev({ type: 'message', role: 'assistant', phase: 'start', turnId: 't1' }))
    store.processEvent(ev({ type: 'message', role: 'assistant', phase: 'end', turnId: 't1', sessionEntryId: 'a1' }))
    for (const id of ['tool-1', 'tool-2']) {
      store.processEvent(ev({ type: 'tool', phase: 'start', toolCallId: id, toolName: 'bash', input: {}, turnId: 't1' }))
      store.processEvent(ev({ type: 'tool', phase: 'end', toolCallId: id, toolName: 'bash', output: 'ok', turnId: 't1' }))
    }
    // Step 2: the final answer.
    store.processEvent(ev({ type: 'message', role: 'assistant', phase: 'start', turnId: 't2' }))
    store.processEvent(ev({ type: 'message', role: 'assistant', phase: 'delta', text: 'Both ran.', turnId: 't2' }))
    store.processEvent(ev({ type: 'message', role: 'assistant', phase: 'end', text: 'Both ran.', turnId: 't2', sessionEntryId: 'a2' }))
    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const rows = useUIStore.getState().timelineItems.filter((item) => item.type !== 'assistant-message' || item.text?.trim())
    expect(rows.map((item) => item.type)).toEqual(['user-message', 'tool-call', 'tool-call', 'assistant-message'])
    expect(rows.at(-1)?.text).toBe('Both ran.')
  })
})
