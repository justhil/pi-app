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
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { ipcClient } from '@renderer/lib/ipc-client'
import { beginSessionNavigation, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { seedSessionForTest } from '@renderer/test/session-state-helpers'
import {
  bindViewToUiStore,
  clearSessionShellForTests,
  focusSessionSync,
  getFocusSessionKey,
  hydrateSessionView,
} from '@renderer/lib/session-shell'
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
    vi.mocked(ipcClient.invoke).mockClear()
    clearStreamPending()
    clearSessionShellForTests()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      currentSessionId: 'session-a',
      pendingNewSessionPlaceholder: false,
      ephemeralSandboxDraft: false,
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

  it.each([
    { kind: 'pending-project' as const, tokenized: true },
    { kind: 'pending-project' as const, tokenized: false },
    { kind: 'ephemeral-sandbox' as const, tokenized: true },
    { kind: 'ephemeral-sandbox' as const, tokenized: false },
  ])('ignores old hydration after entering $kind (navigation token: $tokenized)', async ({ kind, tokenized }) => {
    focusSessionSync('session-a', sessionA)
    const token = beginSessionNavigation()
    const history = deferred<{
      items: ReturnType<typeof useUIStore.getState>['timelineItems']
      sourceCount: number
      totalCount: number
    }>()
    const items = useUIStore.getState().timelineItems
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a', tokenized ? token : undefined)

    enterBlankSession(kind)
    const draftId = kind === 'pending-project' ? '__pending_new__' : '__ephemeral_draft__'
    expect(isSessionNavigationCurrent(token)).toBe(false)
    expect(getFocusSessionKey()).toBeNull()

    history.resolve({ items, sourceCount: items.length, totalCount: items.length })
    await hydration

    expect(useUIStore.getState().currentSessionId).toBe(draftId)
    expect(useUIStore.getState().historySessionFile).toBeNull()
    expect(useUIStore.getState().timelineItems).toEqual([])
    expect(useUIStore.getState().sessionRuntimeRunning[sessionA]).toBe(true)
    expect(ipcClient.invoke).not.toHaveBeenCalledWith('session.setPendingBind', { sessionFile: sessionA })

    focusSessionSync('session-a', sessionA)
    expect(useUIStore.getState().timelineItems.map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(useUIStore.getState().runState.status).toBe('running')
  })

  it.each([false, true])('restores a richer disk reply after visiting a new chat (terminal signal: %s)', async (terminal) => {
    if (terminal) {
      useUIStore.getState().processEvent({
        type: 'run', phase: 'idle', settled: true, runId: 'run-a',
        seq: 1, workspaceId: '/workspace', sessionId: 'session-a', sessionFile: sessionA, timestamp: 3,
      })
    }
    focusSessionSync('session-b', sessionB)
    enterBlankSession('pending-project')
    focusSessionSync('session-a', sessionA)
    const items = useUIStore.getState().timelineItems.map((item) =>
      item.type === 'assistant-message'
        ? { ...item, text: 'complete final answer', thinkingText: 'complete reasoning' }
        : item,
    )
    historyMock.fetch.mockResolvedValueOnce({ items, sourceCount: items.length, totalCount: items.length })

    await hydrateSessionView(sessionA, 'session-a')

    expect(useUIStore.getState().timelineItems.at(-1)).toMatchObject({
      text: 'complete final answer', thinkingText: 'complete reasoning',
    })
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)
    expect(useUIStore.getState().timelineItems.at(-1)?.text).toBe('complete final answer')
  })

  it.each([
    { steering: [], followUp: [] },
    { steering: ['new steering'], followUp: ['new follow-up'] },
  ])('restores the latest background queue on immediate switch-back: %j', (queue) => {
    useUIStore.getState().setPendingQueue(['old steering'], ['old follow-up'])
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)

    useUIStore.getState().processEvent({
      type: 'queue',
      ...queue,
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 3,
    })

    // The background queue must not change the other session's composer.
    expect(useUIStore.getState().pendingSteering).toEqual([])
    expect(useUIStore.getState().pendingFollowUp).toEqual([])
    focusSessionSync('session-a', sessionA)
    expect(useUIStore.getState().pendingSteering).toEqual(queue.steering)
    expect(useUIStore.getState().pendingFollowUp).toEqual(queue.followUp)
  })

  it('keeps a queue consumed in the foreground cleared after the turn becomes idle', () => {
    useUIStore.getState().setPendingQueue(['old steering'], ['old follow-up'])
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)

    useUIStore.getState().processEvent({
      type: 'queue',
      steering: [],
      followUp: [],
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 3,
    })
    useUIStore.getState().processEvent({
      type: 'run',
      phase: 'idle',
      runId: 'run-a',
      settled: true,
      seq: 2,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 4,
    })
    expect(useUIStore.getState().runState.status).toBe('idle')

    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)
    expect(useUIStore.getState().pendingSteering).toEqual([])
    expect(useUIStore.getState().pendingFollowUp).toEqual([])
  })

  it('restores a background queue when opening a session for the first time', async () => {
    const sessionFile = '/tmp/unopened.jsonl'
    useUIStore.getState().processEvent({
      type: 'queue',
      steering: ['background steering'],
      followUp: ['background follow-up'],
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'unopened',
      sessionFile,
      timestamp: 3,
    })

    focusSessionSync('unopened', sessionFile)
    expect(useUIStore.getState().pendingSteering).toEqual(['background steering'])
    expect(useUIStore.getState().pendingFollowUp).toEqual(['background follow-up'])

    historyMock.fetch.mockResolvedValueOnce({ items: [], sourceCount: 0, totalCount: 0 })
    await hydrateSessionView(sessionFile, 'unopened')
    expect(useUIStore.getState().pendingSteering).toEqual(['background steering'])
    expect(useUIStore.getState().pendingFollowUp).toEqual(['background follow-up'])
  })

  it.each([
    { steering: [], followUp: [] },
    { steering: [], followUp: ['old follow-up'] },
    { steering: ['new steering'], followUp: ['old follow-up', 'new follow-up'] },
  ])('preserves visible queue updates while history is loading: %j', async (queue) => {
    useUIStore.getState().setPendingQueue(['old steering'], ['old follow-up'])
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)

    const items = useUIStore.getState().timelineItems
    const history = deferred<{
      items: typeof items
      sourceCount: number
      totalCount: number
    }>()
    historyMock.fetch.mockReturnValueOnce(history.promise)
    const hydration = hydrateSessionView(sessionA, 'session-a')

    useUIStore.getState().processEvent({
      type: 'queue',
      ...queue,
      seq: 1,
      workspaceId: '/workspace',
      sessionId: 'session-a',
      sessionFile: sessionA,
      timestamp: 3,
    })
    expect(useUIStore.getState().pendingSteering).toEqual(queue.steering)
    expect(useUIStore.getState().pendingFollowUp).toEqual(queue.followUp)

    history.resolve({ items, sourceCount: items.length, totalCount: items.length })
    await hydration

    expect(useUIStore.getState().pendingSteering).toEqual(queue.steering)
    expect(useUIStore.getState().pendingFollowUp).toEqual(queue.followUp)
    captureVisibleLiveSessionTimeline()
    focusSessionSync('session-b', sessionB)
    focusSessionSync('session-a', sessionA)
    expect(useUIStore.getState().pendingSteering).toEqual(queue.steering)
    expect(useUIStore.getState().pendingFollowUp).toEqual(queue.followUp)
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

    // A late tail page of the first turn must not replace the follow-up rows this session holds.
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
