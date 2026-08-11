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
vi.mock('@renderer/features/timeline/timeline-bottom-anchor', () => ({
  requestTimelineBottomAnchor: vi.fn(),
}))

import {
  appendOptimisticOutgoingMessage,
  clearOptimisticOutgoing,
} from '@renderer/lib/optimistic-send'
import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { clearLiveSessionTimeline } from '@renderer/lib/live-session-timeline-cache'
import {
  clearSessionShellForTests,
  focusSessionSync,
  hydrateSessionView,
} from '@renderer/lib/session-shell'
import { clearSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { clearStreamPending, flushStreamPendingSync } from '@renderer/stores/ui-store-stream'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const sessionA = '/tmp/opt-a.jsonl'
const sessionB = '/tmp/opt-b.jsonl'

const priorHistory: TimelineItem[] = [
  { id: 'user-1', type: 'user-message', text: 'first question', sessionEntryId: 'u1', timestamp: 1 },
  {
    id: 'asst-1',
    type: 'assistant-message',
    text: 'first answer',
    thinkingText: '',
    sessionEntryId: 'a1',
    timestamp: 2,
  },
]

function userTexts(): string[] {
  return useUIStore
    .getState()
    .timelineItems.filter((item) => item.type === 'user-message')
    .map((item) => item.text ?? '')
}

function sendAndStream(): void {
  appendOptimisticOutgoingMessage('second question')
  useUIStore.getState().processEvent({
    type: 'run',
    phase: 'running',
    runId: 'run-2',
    seq: 1,
    workspaceId: '/workspace',
    sessionFile: sessionA,
    timestamp: 10,
  })
  useUIStore.getState().processEvent({
    type: 'message',
    role: 'user',
    phase: 'start',
    text: 'second question',
    runId: 'run-2',
    turnId: 'turn-2',
    seq: 2,
    workspaceId: '/workspace',
    sessionFile: sessionA,
    timestamp: 11,
  })
  useUIStore.getState().processEvent({
    type: 'message',
    role: 'assistant',
    phase: 'delta',
    text: 'partial ans',
    contentKind: 'text',
    runId: 'run-2',
    turnId: 'turn-2',
    seq: 3,
    workspaceId: '/workspace',
    sessionFile: sessionA,
    timestamp: 12,
  })
  flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
}

function switchToB(): void {
  captureVisibleLiveSessionTimeline()
  focusSessionSync('session-b', sessionB)
}

function backgroundDeltaForA(): void {
  useUIStore.getState().processEvent({
    type: 'message',
    role: 'assistant',
    phase: 'delta',
    text: 'wer grows',
    contentKind: 'text',
    runId: 'run-2',
    turnId: 'turn-2',
    seq: 4,
    workspaceId: '/workspace',
    sessionFile: sessionA,
    timestamp: 13,
  })
}

async function switchBackToA(diskTail: TimelineItem[]): Promise<void> {
  historyMock.fetch.mockResolvedValue({
    items: diskTail,
    totalCount: diskTail.length,
    sourceCount: diskTail.length,
    error: null,
    sessionMeta: undefined,
  })
  captureVisibleLiveSessionTimeline()
  focusSessionSync('session-a', sessionA)
  await hydrateSessionView(sessionA, 'session-a')
}

describe('just-sent user message survives session switch during streaming', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    historyMock.fetch.mockReset()
    historyMock.fetch.mockResolvedValue({
      items: [],
      totalCount: 0,
      sourceCount: 0,
      error: null,
      sessionMeta: undefined,
    })
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
      timelineItems: priorHistory.map((item) => ({ ...item })),
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      pendingSteering: [],
      pendingFollowUp: [],
      sessionRuntimeRunning: {},
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      workerLiveSnapshot: { sessionId: 'session-a', sessionFile: sessionA, status: 'idle' },
      fileChanges: [],
    })
  })

  it('should_clear_failed_optimistic_send_after_switching_away', async () => {
    const token = appendOptimisticOutgoingMessage('never sent')
    switchToB()

    clearOptimisticOutgoing(token)
    await switchBackToA(priorHistory.map((item) => ({ ...item })))

    expect(useUIStore.getState().runState.status).toBe('idle')
    expect(useUIStore.getState().optimisticPendingUserText).toBeNull()
    expect(userTexts()).toEqual(['first question'])
  })

  it('should_keep_user_message_when_disk_tail_lags_behind_send', async () => {
    sendAndStream()
    switchToB()
    backgroundDeltaForA()

    await switchBackToA(priorHistory.map((item) => ({ ...item })))

    expect(userTexts()).toEqual(['first question', 'second question'])
  })

  it('should_keep_user_message_when_disk_tail_already_persisted_it', async () => {
    sendAndStream()
    switchToB()
    backgroundDeltaForA()

    await switchBackToA([
      ...priorHistory.map((item) => ({ ...item })),
      {
        id: 'user-2-disk',
        type: 'user-message',
        text: 'second question',
        sessionEntryId: 'u2',
        turnId: 'turn-2',
        timestamp: 11,
      },
    ])

    expect(userTexts()).toEqual(['first question', 'second question'])
  })

  it('should_keep_user_message_without_any_background_events', async () => {
    sendAndStream()
    switchToB()

    await switchBackToA(priorHistory.map((item) => ({ ...item })))

    expect(userTexts()).toEqual(['first question', 'second question'])
  })

  it('should_keep_optimistic_message_before_worker_echo', async () => {
    appendOptimisticOutgoingMessage('second question')
    switchToB()

    await switchBackToA(priorHistory.map((item) => ({ ...item })))

    expect(userTexts()).toEqual(['first question', 'second question'])
  })
})
