import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageEvent } from '../apply-app-event-types'
import { resolveAppEventRoute } from '../apply-app-event-route'
import { clearStreamPending, flushStreamPendingSync } from '../ui-store-stream'
import { useUIStore } from '../ui-store'

const sessionFile = '/workspace/session.jsonl'
const user = {
  id: 'user-live', type: 'user-message' as const, text: 'question',
  sessionEntryId: 'user-entry', timestamp: 1,
}

function message(patch: Partial<MessageEvent>): MessageEvent {
  return {
    type: 'message', role: 'assistant', phase: 'delta', text: ' next',
    runId: 'run-1', turnId: 'turn-1', seq: 2, timestamp: 3,
    workspaceId: '/workspace', sessionFile, ...patch,
  }
}

function flush(): void {
  flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
}

describe('stream recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    clearStreamPending()
    useUIStore.setState({
      currentWorkspace: '/workspace', currentSessionId: 'session-1',
      historySessionFile: sessionFile, historyLoading: false,
      timelineItems: [user, {
        id: 'assistant-live', type: 'assistant-message', text: 'partial',
        thinkingText: '', timestamp: 2, runId: 'run-1', turnId: 'turn-1',
      }],
      streamingAssistantId: 'assistant-live', optimisticPendingUserText: null,
      agentTurnBootstrapping: false, pendingSteering: [], pendingFollowUp: [],
      sessionRuntimeRunning: { [sessionFile]: true },
      workerLiveSnapshot: { sessionId: 'session-1', sessionFile, status: 'running' },
      runState: { status: 'running', activeRunId: 'run-1', toolCount: 0, errorCount: 0 },
    })
  })

  afterEach(() => {
    clearStreamPending()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('should_preserve_pending_stream_when_history_reloads_mid_reply', () => {
    useUIStore.getState().appendDeltaToStreamingAssistant(' buffered')
    useUIStore.getState().loadHistoryItems([{ ...user, id: 'user-disk' }])
    useUIStore.getState().processEvent(message({}))
    flush()

    const state = useUIStore.getState()
    expect(state.timelineItems.filter((item) => item.type === 'user-message')).toHaveLength(1)
    expect(state.timelineItems.find((item) => item.id === state.streamingAssistantId)?.text)
      .toBe('partial buffered next')
  })

  it.each(['text', 'thinking'] as const)(
    'should_resume_%s_when_streaming_id_points_to_a_removed_row',
    (contentKind) => {
      useUIStore.setState({ timelineItems: [user], streamingAssistantId: 'removed' })
      useUIStore.getState().processEvent(message({ contentKind, text: 'recovered' }))
      flush()

      const state = useUIStore.getState()
      const row = state.timelineItems.find((item) => item.id === state.streamingAssistantId)
      expect(row?.type).toBe('assistant-message')
      expect(contentKind === 'thinking' ? row?.thinkingText : row?.text).toBe('recovered')
    },
  )

  it.each([null, 'removed'])(
    'should_render_final_message_when_start_and_deltas_were_missed_%s',
    (streamingAssistantId) => {
      useUIStore.setState({ timelineItems: [user], streamingAssistantId })
      useUIStore.getState().processEvent(message({
        phase: 'end', text: 'complete answer', sessionEntryId: 'answer-entry',
      }))

      const state = useUIStore.getState()
      expect(state.timelineItems.filter((item) => item.type === 'assistant-message')).toEqual([
        expect.objectContaining({ text: 'complete answer', sessionEntryId: 'answer-entry' }),
      ])
      expect(state.streamingAssistantId).toBeNull()
    },
  )

  it('should_not_duplicate_final_message_when_history_already_contains_its_entry', () => {
    useUIStore.setState({
      streamingAssistantId: null,
      timelineItems: [user, {
        id: 'assistant-disk', type: 'assistant-message', text: 'complete answer',
        sessionEntryId: 'answer-entry', timestamp: 2,
      }],
    })
    useUIStore.getState().processEvent(message({
      phase: 'end', text: 'complete answer', sessionEntryId: 'answer-entry',
    }))
    expect(useUIStore.getState().timelineItems).toHaveLength(2)
  })

  it('should_flush_stream_when_animation_frames_are_suspended', () => {
    useUIStore.getState().processEvent(message({}))
    vi.advanceTimersByTime(100)
    expect(useUIStore.getState().timelineItems.at(-1)?.text).toBe('partial next')

    useUIStore.getState().processEvent(message({ text: ' again' }))
    vi.advanceTimersByTime(100)
    expect(useUIStore.getState().timelineItems.at(-1)?.text).toBe('partial next again')
  })

  it('should_route_same_windows_workspace_when_path_spelling_differs', () => {
    const state = {
      currentWorkspace: 'D:/workspace/pi-app', currentSessionId: 'session-1',
      historySessionFile: 'C:/sessions/chat.jsonl',
      workerLiveSnapshot: { sessionId: 'session-1', sessionFile: 'C:/sessions/chat.jsonl' },
    }
    expect(resolveAppEventRoute(state, message({
      workspaceId: String.raw`d:\workspace\pi-app` + '/',
      sessionFile: String.raw`c:\sessions\chat.jsonl`,
    }))).toBe('visible')
    expect(resolveAppEventRoute(state, message({
      workspaceId: 'D:/another-project', sessionFile: 'C:/sessions/other.jsonl',
    }))).toBe('background')
  })
})
