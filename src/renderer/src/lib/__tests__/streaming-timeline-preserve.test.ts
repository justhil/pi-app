import { describe, expect, it } from 'vitest'
import { saveLiveSessionTimeline, getLiveSessionTimeline } from '../live-session-timeline-cache'
import {
  applyLiveStreamingTextToMergedTimeline,
  mergeLiveCacheTimelineSnapshots,
} from '../streaming-timeline-preserve'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

describe('streaming-timeline-preserve', () => {
  it('mergeLiveCacheTimelineSnapshots keeps longer text across different assistant ids', () => {
    const merged = mergeLiveCacheTimelineSnapshots(
      [
        { id: 'opt-user-1', type: 'user-message', text: 'q', timestamp: 1 },
        { id: 'opt-asst-1', type: 'assistant-message', text: 'ab', timestamp: 2 },
      ],
      [
        { id: 'cached-u', type: 'user-message', text: 'q', timestamp: 1 },
        { id: 'cached-live-9', type: 'assistant-message', text: 'full streamed body', timestamp: 2 },
      ],
    )
    expect(merged.at(-1)?.text).toBe('full streamed body')
  })

  it('prefers full-page capture over stream-only tail even if assistant text is longer', () => {
    const fullPage: TimelineItem[] = [
      { id: 'h1', type: 'user-message', text: 'older', timestamp: 1 },
      { id: 'h2', type: 'assistant-message', text: 'old answer', timestamp: 2 },
      { id: 'h3', type: 'user-message', text: 'current', timestamp: 3 },
      { id: 'h4', type: 'assistant-message', text: 'partial', timestamp: 4 },
    ]
    const streamOnly: TimelineItem[] = [
      { id: 'l1', type: 'assistant-message', text: 'partial and much longer streamed body', timestamp: 5 },
    ]
    const merged = mergeLiveCacheTimelineSnapshots(streamOnly, fullPage)
    expect(merged.filter((i) => i.type === 'user-message')).toHaveLength(2)
    expect(merged.at(-1)?.text).toBe('partial and much longer streamed body')
  })

  it('saveLiveSessionTimeline keeps longer assistant text from existing cache', () => {
    saveLiveSessionTimeline({
      sessionId: 's1',
      sessionFile: '/tmp/p.jsonl',
      timelineItems: [
        { id: 'a1', type: 'assistant-message', text: 'hello world streaming', timestamp: 1 },
      ],
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    saveLiveSessionTimeline({
      sessionId: 's1',
      sessionFile: '/tmp/p.jsonl',
      timelineItems: [{ id: 'a1', type: 'assistant-message', text: 'ello', timestamp: 1 }],
      streamingAssistantId: 'a1',
      runState: { status: 'running', toolCount: 0, errorCount: 0 },
      pendingSteering: [],
      pendingFollowUp: [],
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
    })

    expect(getLiveSessionTimeline('/tmp/p.jsonl')?.timelineItems[0]?.text).toBe('hello world streaming')
  })

  it('applyLiveStreamingTextToMergedTimeline enriches disk-empty assistant from live cache', () => {
    const diskMerged: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'q', timestamp: 1 },
      { id: 'h4', type: 'assistant-message', text: '', timestamp: 2 },
    ]
    const liveItems: TimelineItem[] = [
      { id: 'l2', type: 'assistant-message', text: 'full streamed prefix and more', timestamp: 3 },
    ]
    const out = applyLiveStreamingTextToMergedTimeline(diskMerged, liveItems, 'l2')
    expect(out.at(-1)?.text).toBe('full streamed prefix and more')
  })
})