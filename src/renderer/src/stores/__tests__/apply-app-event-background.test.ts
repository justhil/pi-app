import { beforeEach, describe, expect, it } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import type { StoreApi } from '@renderer/stores/apply-app-event-types'
import type { RunState, TimelineItem, UIState } from '@renderer/stores/ui-store-types'
import { applyAppEvent } from '../apply-app-event'
import {
  clearLiveSessionTimeline,
  getLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { clearSessionTimelineView, getSessionTimelineView } from '@renderer/lib/session-timeline-views'

const liveFile = '/tmp/live.jsonl'
const previewFile = '/tmp/preview.jsonl'

const baseItems: TimelineItem[] = [
  { id: 'u1', type: 'user-message', text: 'tell me more', timestamp: 1 },
  { id: 'a1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 2 },
]

function makeApi(): StoreApi {
  const runState: RunState = { status: 'idle', toolCount: 0, errorCount: 0 }
  const state: Record<string, unknown> = {
    currentWorkspace: '/w/preview',
    currentSessionId: 'preview-session',
    historySessionFile: previewFile,
    workerLiveSnapshot: { sessionId: null, sessionFile: liveFile, status: 'running' as const },
    timelineItems: [] as TimelineItem[],
    streamingAssistantId: null,
    runState,
    fileChanges: [],
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    ignoreQueueSyncUntil: 0,
    pendingSteering: [] as string[],
    pendingFollowUp: [] as string[],
    rightPanelCatalog: [],
    rightPanelPrefs: {},
    setWorkerLiveSnapshot: (snap: UIState['workerLiveSnapshot']) => {
      state.workerLiveSnapshot = snap
    },
    setPendingQueue: (steering: string[], followUp: string[]) => {
      state.pendingSteering = steering
      state.pendingFollowUp = followUp
    },
    addFileChange: () => undefined,
    appendTimeline: (item: TimelineItem) => {
      const items = state.timelineItems as TimelineItem[]
      state.timelineItems = [...items, item]
    },
    setRunState: (patch: Partial<RunState>) => {
      state.runState = { ...(state.runState as RunState), ...patch }
    },
  }
  return {
    get: () => state as unknown as UIState,
    set: (partial) => Object.assign(state, partial),
    nextItemId: () => 'visible-item',
  }
}

describe('applyAppEvent background live session routing', () => {
  beforeEach(() => {
    clearLiveSessionTimeline(liveFile)
    clearLiveSessionTimeline(previewFile)
    clearSessionTimelineView()
    saveLiveSessionTimeline({
      sessionId: 'live-session',
      sessionFile: liveFile,
      timelineItems: baseItems,
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })
  })

  it('keeps background deltas in the live cache by sessionFile even when event sessionId is unavailable', () => {
    const api = makeApi()
    applyAppEvent(
      {
        type: 'message',
        role: 'assistant',
        phase: 'delta',
        contentKind: 'text',
        text: 'streamed text',
        seq: 1,
        workspaceId: '/w',
        sessionFile: liveFile,
        timestamp: 3,
      } as AppEvent,
      api,
    )

    expect(api.get().timelineItems).toEqual([])
    expect(getLiveSessionTimeline(liveFile)?.timelineItems.at(-1)?.text).toBe('streamed text')
    expect(getSessionTimelineView(liveFile)?.tail.at(-1)?.text).toBe('streamed text')
  })
})
