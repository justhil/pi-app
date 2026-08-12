import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearLiveSessionTimeline,
  getLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { useUIStore } from '../ui-store'

const sessionFile = '/workspace/session.jsonl'

function seedStaleRunningLiveSnapshot(): void {
  // Mid-stream switch-away wrote a running snapshot into the live cache.
  saveLiveSessionTimeline({
    sessionId: 'session-1',
    sessionFile,
    timelineItems: [
      { id: 'u1', type: 'user-message', text: 'question', timestamp: 1 },
      { id: 'a1', type: 'assistant-message', text: 'partial answ', thinkingText: '', timestamp: 2 },
    ],
    streamingAssistantId: 'a1',
    runState: { status: 'running', toolCount: 0, errorCount: 0, activeRunId: 'run-1' },
    pendingSteering: [],
    pendingFollowUp: [],
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
  })
}

describe('visible run terminal retires stale live cache', () => {
  beforeEach(() => {
    clearLiveSessionTimeline()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-1',
      historySessionFile: sessionFile,
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'question', timestamp: 1 },
        { id: 'a1', type: 'assistant-message', text: 'partial answer done', thinkingText: '', timestamp: 2 },
      ],
      streamingAssistantId: 'a1',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { [sessionFile]: true },
      workerLiveSnapshot: { sessionId: 'session-1', sessionFile, status: 'running' },
      runState: { status: 'running', activeRunId: 'run-1', toolCount: 0, errorCount: 0 },
    })
  })

  afterEach(() => {
    clearLiveSessionTimeline()
  })

  it('should_clear_live_streaming_markers_when_visible_run_goes_idle', () => {
    seedStaleRunningLiveSnapshot()

    useUIStore.getState().processEvent({
      type: 'run',
      phase: 'idle',
      runId: 'run-1',
      seq: 10,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })

    const live = getLiveSessionTimeline(sessionFile)
    expect(live?.runState.status).toBe('idle')
    expect(live?.streamingAssistantId).toBeNull()
    expect(live?.optimisticPendingUserText).toBeNull()
    expect(live?.agentTurnBootstrapping).toBe(false)
    expect(
      Object.values(useUIStore.getState().sessionRuntimeRunning).some((v) => v === true),
    ).toBe(false)
  })

  it('should_clear_live_streaming_markers_when_visible_run_fails', () => {
    seedStaleRunningLiveSnapshot()

    useUIStore.getState().processEvent({
      type: 'run',
      phase: 'failed',
      runId: 'run-1',
      seq: 10,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })

    const live = getLiveSessionTimeline(sessionFile)
    expect(live?.runState.status).toBe('failed')
    expect(live?.streamingAssistantId).toBeNull()
  })

  it('should_clear_live_streaming_markers_on_visible_agent_abort', () => {
    seedStaleRunningLiveSnapshot()

    useUIStore.getState().processEvent({
      type: 'agent_error',
      text: 'aborted',
      kind: 'aborted',
      runId: 'run-1',
      seq: 10,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })

    const live = getLiveSessionTimeline(sessionFile)
    expect(live?.runState.status).toBe('idle')
    expect(live?.streamingAssistantId).toBeNull()
  })

  it('should_not_create_live_cache_entry_for_sessions_without_one', () => {
    useUIStore.getState().processEvent({
      type: 'run',
      phase: 'idle',
      runId: 'run-1',
      seq: 10,
      workspaceId: '/workspace',
      sessionFile,
      timestamp: 5,
    })

    expect(getLiveSessionTimeline(sessionFile)).toBeNull()
  })
})
