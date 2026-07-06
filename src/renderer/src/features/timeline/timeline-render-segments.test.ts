import { describe, expect, it } from 'vitest'
import { splitTimelineRenderSegments, sliceHistoryForViewport } from './timeline-render-segments'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

describe('splitTimelineRenderSegments', () => {
  it('keeps live head from last user when streaming', () => {
    const items: TimelineItem[] = [
      { id: '1', type: 'assistant-message', text: 'old', timestamp: 1 },
      { id: '2', type: 'user-message', text: 'q', timestamp: 2 },
      { id: '3', type: 'assistant-message', text: '...', timestamp: 3 },
    ]
    const { history, liveHead } = splitTimelineRenderSegments(items, { streamingAssistantId: '3' })
    expect(history.map((i) => i.id)).toEqual(['1'])
    expect(liveHead.map((i) => i.id)).toEqual(['2', '3'])
  })
})

describe('sliceHistoryForViewport', () => {
  it('takes tail window of history only', () => {
    const h = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), type: 'assistant-message' as const, text: '', timestamp: n }))
    expect(sliceHistoryForViewport(h, 2).map((i) => i.id)).toEqual(['4', '5'])
  })
})