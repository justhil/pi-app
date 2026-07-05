import { describe, expect, it } from 'vitest'
import { mergeLiveTimelineWithHistoryTail } from '../merge-live-history-timeline'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const history: TimelineItem[] = [
  { id: 'h1', type: 'user-message', text: 'older question', timestamp: 1 },
  { id: 'h2', type: 'assistant-message', text: 'older answer', timestamp: 2 },
  { id: 'h3', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
  { id: 'h4', type: 'assistant-message', text: '', thinkingText: '', timestamp: 4 },
]

const liveTail: TimelineItem[] = [
  { id: 'l1', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
  { id: 'l2', type: 'assistant-message', text: 'streaming partial', timestamp: 5 },
]

describe('mergeLiveTimelineWithHistoryTail', () => {
  it('prefers longer live assistant text over empty disk placeholder on same turn', () => {
    const histWithEmpty: TimelineItem[] = [
      { id: 'h3', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
      { id: 'h4', type: 'assistant-message', text: '', timestamp: 4 },
    ]
    const liveWithText: TimelineItem[] = [
      { id: 'l1', type: 'user-message', text: 'current question', timestamp: 3, sessionEntryId: 'u-current' },
      { id: 'l2', type: 'assistant-message', text: 'already streamed paragraph', timestamp: 5 },
    ]
    const merged = mergeLiveTimelineWithHistoryTail(histWithEmpty, liveWithText)
    expect(merged.at(-1)?.text).toBe('already streamed paragraph')
  })

  it('keeps older history when live cache only captured the active tail', () => {
    const merged = mergeLiveTimelineWithHistoryTail(history, liveTail)
    expect(merged.map((i) => i.id)).toEqual(['h1', 'h2', 'h3', 'l2'])
    expect(merged.at(-1)?.text).toBe('streaming partial')
  })
})