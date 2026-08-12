import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { clearStreamPending, flushStreamPendingSync } from '../ui-store-stream'
import { useUIStore } from '../ui-store'

const terminalEvents: Array<{ name: string; event: AppEvent }> = [
  {
    name: 'tool start',
    event: {
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-1',
      toolName: 'read',
      input: {},
      runId: 'run-1',
      seq: 1,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 3,
    },
  },
  {
    name: 'agent error',
    event: {
      type: 'agent_error',
      text: 'stream failed',
      kind: 'error',
      runId: 'run-1',
      seq: 2,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 4,
    },
  },
  {
    name: 'run idle',
    event: {
      type: 'run',
      phase: 'idle',
      runId: 'run-1',
      seq: 3,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 5,
    },
  },
]

describe('foreground stream terminal ordering', () => {
  beforeEach(() => {
    clearStreamPending()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-1',
      historySessionFile: '/workspace/session.jsonl',
      historyLoading: false,
      timelineItems: [
        {
          id: 'opt-asst-1',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          timestamp: 1,
        },
      ],
      streamingAssistantId: 'opt-asst-1',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { '/workspace/session.jsonl': true },
      workerLiveSnapshot: {
        sessionId: 'session-1',
        sessionFile: '/workspace/session.jsonl',
        status: 'running',
      },
      runState: {
        status: 'running',
        activeRunId: 'run-1',
        toolCount: 0,
        errorCount: 0,
      },
    })
  })

  afterEach(() => {
    clearStreamPending()
    vi.unstubAllGlobals()
  })

  it.each(terminalEvents)('should_preserve_pending_text_before_$name', ({ event }) => {
    useUIStore.getState().appendDeltaToStreamingAssistant('last chunk')
    useUIStore.getState().processEvent(event)

    flushStreamPendingSync(useUIStore.getState, useUIStore.setState)

    const assistant = useUIStore
      .getState()
      .timelineItems.find((item) => item.id === 'opt-asst-1')
    expect(assistant?.text).toBe('last chunk')
  })

  it('should_preserve_repeated_delta_chunks_and_authoritative_final_text', () => {
    useUIStore.getState().appendDeltaToStreamingAssistant('ha')
    useUIStore.getState().appendDeltaToStreamingAssistant('ha')
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'end',
      text: 'hahaha',
      runId: 'run-1',
      seq: 4,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 6,
    })

    const assistant = useUIStore
      .getState()
      .timelineItems.find((item) => item.id === 'opt-asst-1')
    expect(assistant?.text).toBe('hahaha')
  })

  it('should_flush_pending_thinking_before_message_end_clears_streaming_id', () => {
    useUIStore.getState().appendThinkingDelta('ha')
    useUIStore.getState().appendThinkingDelta('ha')
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'end',
      text: '',
      runId: 'run-1',
      seq: 5,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 7,
    })

    const state = useUIStore.getState()
    const assistant = state.timelineItems.find((item) => item.id === 'opt-asst-1')
    expect(assistant?.thinkingText).toBe('haha')
    expect(state.streamingAssistantId).toBeNull()
  })

  it('should_keep_identical_persisted_user_turns_as_distinct_rows', () => {
    useUIStore.setState({
      timelineItems: [
        {
          id: 'persisted-user-1',
          type: 'user-message',
          text: 'continue',
          sessionEntryId: 'entry-1',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      optimisticPendingUserText: null,
    })

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'continue',
      runId: 'run-2',
      seq: 6,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 8,
    })

    expect(
      useUIStore.getState().timelineItems.filter((item) => item.type === 'user-message'),
    ).toHaveLength(2)
  })

  it('should_not_reuse_stale_optimistic_user_id_without_pending_marker', () => {
    useUIStore.setState({
      timelineItems: [
        {
          id: 'opt-user-stale',
          type: 'user-message',
          text: 'continue',
          sessionEntryId: 'entry-old',
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      optimisticPendingUserText: null,
    })

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'continue',
      runId: 'run-2',
      seq: 7,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 9,
    })

    expect(
      useUIStore.getState().timelineItems.filter((item) => item.type === 'user-message'),
    ).toHaveLength(2)
  })

  it('should_reuse_only_the_matching_optimistic_user_row', () => {
    const command = '/skill:demo-skill explain this'
    useUIStore.setState({
      timelineItems: [
        {
          id: 'opt-user-1',
          type: 'user-message',
          text: command,
          timestamp: 1,
        },
      ],
      streamingAssistantId: null,
      optimisticPendingUserText: command,
    })

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: command,
      runId: 'run-2',
      seq: 7,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 9,
    })

    const state = useUIStore.getState()
    expect(state.timelineItems.filter((item) => item.type === 'user-message')).toHaveLength(1)
    expect(state.timelineItems.find((item) => item.type === 'user-message')?.text).toBe(command)
    expect(state.optimisticPendingUserText).toBeNull()
  })

  it('should_bind_turn_id_to_visible_optimistic_message_and_tool_rows', () => {
    useUIStore.setState({
      timelineItems: [
        { id: 'opt-user-turn', type: 'user-message', text: 'question', timestamp: 1 },
        {
          id: 'opt-asst-turn',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'opt-asst-turn',
      optimisticPendingUserText: 'question',
    })

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'question',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 8,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 10,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'end',
      sessionEntryId: 'user-entry-turn',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 9,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 11,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'start',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 10,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 12,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'end',
      text: 'answer',
      sessionEntryId: 'assistant-entry-turn',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 11,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 13,
    })
    useUIStore.getState().processEvent({
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-turn',
      toolName: 'read',
      input: {},
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 12,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 14,
    })
    useUIStore.getState().processEvent({
      type: 'tool',
      phase: 'end',
      toolCallId: 'tool-turn',
      toolName: 'read',
      output: 'ok',
      turnId: 'turn-1',
      runId: 'run-1',
      seq: 13,
      workspaceId: '/workspace',
      sessionFile: '/workspace/session.jsonl',
      timestamp: 15,
    })

    const rows = useUIStore.getState().timelineItems
    expect(rows.find((item) => item.id === 'opt-user-turn')).toMatchObject({
      turnId: 'turn-1',
      sessionEntryId: 'user-entry-turn',
    })
    expect(rows.find((item) => item.id === 'opt-asst-turn')).toMatchObject({
      turnId: 'turn-1',
      sessionEntryId: 'assistant-entry-turn',
    })
    expect(rows.find((item) => item.toolCallId === 'tool-turn')).toMatchObject({
      turnId: 'turn-1',
      toolPhase: 'end',
    })
  })
})
