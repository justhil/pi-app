import { describe, expect, it } from 'vitest'
import { applyBackgroundAppEventToLiveTimeline, getLiveSessionTimeline, saveLiveSessionTimeline } from '../live-session-timeline-cache'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const baseItems: TimelineItem[] = [
  { id: 'u1', type: 'user-message', text: 'hello', timestamp: 1 },
  { id: 'a1', type: 'assistant-message', text: '', thinkingText: '', timestamp: 2 },
]

describe('live-session-timeline-cache', () => {
  it('keeps streaming assistant text while session is viewed in background', () => {
    saveLiveSessionTimeline({
      sessionId: 's1',
      sessionFile: '/tmp/s1.jsonl',
      timelineItems: baseItems,
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    applyBackgroundAppEventToLiveTimeline('/tmp/s1.jsonl', {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'partial reply',
      seq: 1,
      workspaceId: '/w',
      sessionId: 's1',
      timestamp: 3,
    })

    const snap = getLiveSessionTimeline('/tmp/s1.jsonl')
    expect(snap?.streamingAssistantId).toBe('a1')
    expect(snap?.timelineItems.at(-1)?.text).toBe('partial reply')
  })

  it('bootstraps background cache when capture was missed', () => {
    applyBackgroundAppEventToLiveTimeline('/tmp/s2.jsonl', {
      type: 'message',
      role: 'assistant',
      phase: 'delta',
      contentKind: 'text',
      text: 'late stream',
      seq: 3,
      workspaceId: '/w',
      sessionFile: '/tmp/s2.jsonl',
      timestamp: 5,
    })

    expect(getLiveSessionTimeline('/tmp/s2.jsonl')?.timelineItems.at(-1)?.text).toBe('late stream')
  })

  it('marks cached live turn idle when background run ends', () => {
    applyBackgroundAppEventToLiveTimeline('/tmp/s1.jsonl', {
      type: 'run',
      phase: 'idle',
      seq: 2,
      workspaceId: '/w',
      sessionId: 's1',
      timestamp: 4,
    })

    expect(getLiveSessionTimeline('/tmp/s1.jsonl')?.runState.status).toBe('idle')
  })
})
