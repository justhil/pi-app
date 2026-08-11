import { beforeEach, describe, expect, it, vi } from 'vitest'

const historyMock = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))
vi.mock('@renderer/lib/session-history', () => ({
  fetchSessionHistoryTail: historyMock.fetch,
}))
vi.mock('@renderer/lib/session-display-meta', () => ({
  applyComposerDisplayMeta: vi.fn().mockResolvedValue(undefined),
}))

import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import {
  clearLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import {
  bindViewToUiStore,
  clearSessionShellForTests,
  focusSessionSync,
  hydrateSessionView,
} from '@renderer/lib/session-shell'
import { clearSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { clearStreamPending } from '@renderer/stores/ui-store-stream'
import { useUIStore } from '@renderer/stores/ui-store'

const sessionA = '/tmp/stream-a.jsonl'
const sessionB = '/tmp/stream-b.jsonl'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('session shell stream switch race', () => {
  let animationFrames: FrameRequestCallback[]

  beforeEach(() => {
    animationFrames = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    historyMock.fetch.mockReset()
    clearStreamPending()
    clearLiveSessionTimeline()
    clearSessionTimelineView()
    clearSessionShellForTests()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-a',
      historySessionFile: sessionA,
      historyTotalCount: 2,
      historyLoadedCount: 2,
      historyLoading: false,
      timelineItems: [
        {
          id: 'user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          timestamp: 1,
        },
        {
          id: 'assistant-before-tool',
          type: 'assistant-message',
          text: 'before tool',
          thinkingText: '',
          timestamp: 2,
        },
      ],
      streamingAssistantId: 'assistant-before-tool',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: { [sessionA]: true },
      runState: {
        status: 'running',
        activeRunId: 'run-a',
        toolCount: 0,
        errorCount: 0,
      },
      workerLiveSnapshot: {
        sessionId: 'session-a',
        sessionFile: sessionA,
        status: 'running',
      },
      fileChanges: [],
    })
  })

  it('should_bind_remapped_stream_id_that_exists_in_session_view', () => {
    saveLiveSessionTimeline({
      sessionId: 'session-a',
      sessionFile: sessionA,
      timelineItems: [
        {
          id: 'live-assistant',
          type: 'assistant-message',
          text: 'live',
          runId: 'run-a',
          turnId: 'turn-a',
          timestamp: 3,
        },
      ],
      streamingAssistantId: 'live-assistant',
      runState: { status: 'running', activeRunId: 'run-a', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    bindViewToUiStore({
      sessionKey: sessionA,
      sessionId: 'session-a',
      items: [
        {
          id: 'disk-user',
          type: 'user-message',
          text: 'question',
          turnId: 'turn-a',
          timestamp: 1,
        },
        {
          id: 'disk-assistant',
          type: 'assistant-message',
          text: 'richer disk partial',
          runId: 'run-a',
          turnId: 'turn-a',
          timestamp: 2,
        },
      ],
      historyTotal: 2,
      historyLoaded: 2,
      runUI: 'running',
      streamingAssistantId: 'live-assistant',
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      phase: 'cached',
      lastFocusedAt: 1,
    })

    const state = useUIStore.getState()
    expect(state.streamingAssistantId).toBe('disk-assistant')
    expect(
      state.timelineItems.some(
        (item) =>
          item.type === 'assistant-message' && item.id === state.streamingAssistantId,
      ),
    ).toBe(true)
  })

  it('should_honor_background_tool_boundary_when_switching_back', () => {
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)

    useUIStore.getState().processEvent({
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-a',
      toolName: 'read',
      input: { path: 'README.md' },
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 3,
    })

    focusSessionSync('session-a', sessionA)

    expect(useUIStore.getState().streamingAssistantId).toBeNull()
    expect(useUIStore.getState().timelineItems.at(-1)?.toolCallId).toBe('tool-a')
  })

  it('should_keep_visible_stream_events_when_stale_hydrate_finishes_after_switch_back', async () => {
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)

    useUIStore.getState().processEvent({
      type: 'tool',
      phase: 'start',
      toolCallId: 'tool-a',
      toolName: 'read',
      input: { path: 'README.md' },
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 3,
    })

    focusSessionSync('session-a', sessionA)

    const history = deferred<{
      items: Array<Record<string, unknown>>
      sourceCount: number
      totalCount: number
    }>()
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a')

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'start',
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 4,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'after tool',
      seq: 3,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 5,
    })

    history.resolve({
      items: [
        {
          id: 'disk-old-user',
          type: 'user-message',
          text: 'older question',
          sessionEntryId: 'old-user-entry',
          timestamp: -1,
        },
        {
          id: 'disk-old-assistant',
          type: 'assistant-message',
          text: 'older answer',
          sessionEntryId: 'old-assistant-entry',
          timestamp: 0,
        },
        {
          id: 'disk-user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          timestamp: 1,
        },
        {
          id: 'disk-assistant-before-tool',
          type: 'assistant-message',
          text: 'before tool',
          timestamp: 2,
        },
      ],
      sourceCount: 4,
      totalCount: 4,
    })
    await hydration

    for (const callback of animationFrames.splice(0)) callback(performance.now())

    const items = useUIStore.getState().timelineItems
    expect(items.map((item) => item.type)).toEqual([
      'user-message',
      'assistant-message',
      'user-message',
      'assistant-message',
      'tool-call',
      'assistant-message',
    ])
    expect(items[0]?.text).toBe('older question')
    expect(items[1]?.text).toBe('older answer')
    expect(items.find((item) => item.toolCallId === 'tool-a')).toBeDefined()
    expect(items.at(-1)?.text).toBe('after tool')
    expect(useUIStore.getState().streamingAssistantId).toBe(items.at(-1)?.id)
  })

  it('should_keep_background_follow_up_when_stale_hydrate_resolves_after_switch_back', async () => {
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'end',
      text: 'first complete answer',
      sessionEntryId: 'assistant-entry-a',
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 3,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'queued follow-up',
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 4,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'end',
      sessionEntryId: 'user-entry-follow-up',
      seq: 3,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 5,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'start',
      seq: 4,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 6,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'second answer streaming',
      seq: 5,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 7,
    })

    focusSessionSync('session-a', sessionA)
    const history = deferred<{
      items: Array<Record<string, unknown>>
      sourceCount: number
      totalCount: number
    }>()
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a')

    history.resolve({
      items: [
        {
          id: 'disk-user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          timestamp: 1,
        },
      ],
      sourceCount: 1,
      totalCount: 1,
    })
    await hydration

    const items = useUIStore.getState().timelineItems
    expect(items.map((item) => [item.type, item.text])).toEqual([
      ['user-message', 'question'],
      ['assistant-message', 'first complete answer'],
      ['user-message', 'queued follow-up'],
      ['assistant-message', 'second answer streaming'],
    ])
    expect(useUIStore.getState().streamingAssistantId).toBe(items[3]?.id)
  })

  it('should_reject_stale_no_user_tail_from_prior_queued_turn_on_late_hydrate', async () => {
    useUIStore.setState({
      timelineItems: [
        {
          id: 'user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          turnId: 'turn-1',
          timestamp: 1,
        },
        {
          id: 'assistant-a1',
          type: 'assistant-message',
          text: 'first answer',
          sessionEntryId: 'assistant-entry-a',
          turnId: 'turn-1',
          runId: 'run-a',
          timestamp: 2,
        },
      ],
      streamingAssistantId: null,
    })
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'start',
      text: 'queued follow-up',
      turnId: 'turn-2',
      runId: 'run-a',
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 3,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'user',
      phase: 'end',
      sessionEntryId: 'user-entry-follow-up',
      turnId: 'turn-2',
      runId: 'run-a',
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 4,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'start',
      turnId: 'turn-2',
      runId: 'run-a',
      seq: 3,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 5,
    })
    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'second answer streaming',
      turnId: 'turn-2',
      runId: 'run-a',
      seq: 4,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 6,
    })

    focusSessionSync('session-a', sessionA)
    const current = useUIStore.getState()
    const currentAssistant = current.timelineItems.at(-1)
    expect(currentAssistant).toMatchObject({
      type: 'assistant-message',
      text: 'second answer streaming',
      turnId: 'turn-2',
    })

    clearLiveSessionTimeline(sessionA)
    saveLiveSessionTimeline({
      sessionId: 'session-a',
      sessionFile: sessionA,
      timelineItems: [
        {
          id: 'stale-assistant-a1',
          type: 'assistant-message',
          text: 'stale first answer tail',
          turnId: 'turn-1',
          runId: 'run-a',
          timestamp: 7,
        },
        {
          id: 'stale-tool-a1',
          type: 'tool-call',
          toolCallId: 'stale-tool',
          toolName: 'read',
          toolPhase: 'end',
          turnId: 'turn-1',
          runId: 'run-a',
          timestamp: 8,
        },
      ],
      streamingAssistantId: 'stale-assistant-a1',
      runState: { status: 'running', activeRunId: 'run-a', toolCount: 1, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const history = deferred<{
      items: Array<Record<string, unknown>>
      sourceCount: number
      totalCount: number
    }>()
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a')
    history.resolve({
      items: [
        {
          id: 'disk-user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          turnId: 'turn-1',
          timestamp: 1,
        },
        {
          id: 'disk-assistant-a1',
          type: 'assistant-message',
          text: 'first answer',
          sessionEntryId: 'assistant-entry-a',
          turnId: 'turn-1',
          timestamp: 2,
        },
      ],
      sourceCount: 2,
      totalCount: 2,
    })
    await hydration

    const state = useUIStore.getState()
    expect(state.timelineItems.map((item) => [item.type, item.text])).toEqual([
      ['user-message', 'question'],
      ['assistant-message', 'first answer'],
      ['user-message', 'queued follow-up'],
      ['assistant-message', 'second answer streaming'],
    ])
    expect(state.timelineItems.some((item) => item.toolCallId === 'stale-tool')).toBe(false)
    expect(state.streamingAssistantId).toBe(currentAssistant?.id)
  })

  it('should_keep_visible_terminal_message_when_hydrate_finishes_late', async () => {
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-a', sessionA)

    const history = deferred<{
      items: Array<Record<string, unknown>>
      sourceCount: number
      totalCount: number
    }>()
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a')

    useUIStore.getState().processEvent({
      type: 'message',
      role: 'assistant',
      phase: 'end',
      contentKind: 'text',
      text: 'complete final answer',
      sessionEntryId: 'assistant-entry-a',
      seq: 4,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      runId: 'run-a',
      timestamp: 6,
    })

    history.resolve({
      items: [
        {
          id: 'disk-old-user',
          type: 'user-message',
          text: 'older question',
          sessionEntryId: 'old-user-entry',
          timestamp: -1,
        },
        {
          id: 'disk-old-assistant',
          type: 'assistant-message',
          text: 'older answer',
          sessionEntryId: 'old-assistant-entry',
          timestamp: 0,
        },
        {
          id: 'disk-user-a',
          type: 'user-message',
          text: 'question',
          sessionEntryId: 'user-entry-a',
          timestamp: 1,
        },
        {
          id: 'disk-assistant-before-tool',
          type: 'assistant-message',
          text: 'before tool',
          timestamp: 2,
        },
      ],
      sourceCount: 4,
      totalCount: 4,
    })
    await hydration

    const items = useUIStore.getState().timelineItems
    expect(items[0]?.text).toBe('older question')
    expect(items[1]?.text).toBe('older answer')
    const assistant = items.at(-1)
    expect(assistant?.text).toBe('complete final answer')
    expect(assistant?.sessionEntryId).toBe('assistant-entry-a')
    expect(useUIStore.getState().streamingAssistantId).toBeNull()
  })
})
