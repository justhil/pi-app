import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLiveSessionTimeline, getLiveSessionTimeline } from '../live-session-timeline-cache'

const workerFile = '/tmp/worker.jsonl'
const previewFile = '/tmp/preview.jsonl'

vi.mock('@renderer/stores/ui-store-stream', () => ({
  flushStreamPendingSync: vi.fn(),
}))

let mockState: Record<string, unknown> = {}

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => mockState,
    setState: vi.fn(),
  },
}))

describe('captureVisibleLiveSessionTimeline', () => {
  beforeEach(() => {
    clearLiveSessionTimeline(workerFile)
    clearLiveSessionTimeline(previewFile)
    mockState = {
      historySessionFile: previewFile,
      currentSessionId: 'preview',
      workerLiveSnapshot: { sessionId: 'w1', sessionFile: workerFile, status: 'running' },
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      streamingAssistantId: null,
      timelineItems: [],
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      sessionRuntimeRunning: {},
    }
  })

  it('refreshes worker live cache runState when viewing preview while worker keeps running', async () => {
    const { saveLiveSessionTimeline } = await import('../live-session-timeline-cache')
    saveLiveSessionTimeline({
      sessionId: 'w1',
      sessionFile: workerFile,
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'hi', timestamp: 1 },
        { id: 'a1', type: 'assistant-message', text: 'partial', timestamp: 2 },
      ],
      streamingAssistantId: 'a1',
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    const { captureVisibleLiveSessionTimeline } = await import('../capture-live-session-timeline')
    captureVisibleLiveSessionTimeline()

    const cached = getLiveSessionTimeline(workerFile)
    expect(cached?.timelineItems.at(-1)?.text).toBe('partial')
    expect(cached?.runState.status).toBe('running')
  })
})