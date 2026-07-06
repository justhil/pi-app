import { describe, expect, it } from 'vitest'
import { deriveTurnTimingsFromItems, formatTurnDuration } from './timeline-turn-timing'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

describe('deriveTurnTimingsFromItems', () => {
  it('computes duration from user to last item in turn', () => {
    const items: TimelineItem[] = [
      { id: 'u1', type: 'user-message', text: 'hi', timestamp: 1000, sessionEntryId: 'e1' },
      { id: 'a1', type: 'assistant-message', text: 'ok', timestamp: 5000 },
    ]
    const m = deriveTurnTimingsFromItems(items)
    expect(m.get('e1')?.durationMs).toBe(4000)
  })
})

describe('formatTurnDuration', () => {
  it('formats seconds', () => {
    expect(formatTurnDuration(4500)).toBe('5s')
  })
})