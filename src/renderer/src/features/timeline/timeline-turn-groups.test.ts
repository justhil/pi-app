import { describe, expect, it } from 'vitest'
import { buildTimelineDisplayItems } from './timeline-display-items'
import { groupDisplayBlocksByTurn } from './timeline-turn-groups'

describe('groupDisplayBlocksByTurn', () => {
  it('uses unique turnId per user row when sessionEntryId repeats', () => {
    const raw = [
      { id: 'u-a', type: 'user-message', text: 'q1', timestamp: 1, sessionEntryId: 'e48207d2' },
      { id: 'a1', type: 'assistant-message', text: 'a1', timestamp: 2 },
      { id: 'u-b', type: 'user-message', text: 'q2', timestamp: 3, sessionEntryId: 'e48207d2' },
      { id: 'a2', type: 'assistant-message', text: 'a2', timestamp: 4 },
    ]
    const blocks = buildTimelineDisplayItems(raw)
    const { turns } = groupDisplayBlocksByTurn(blocks)
    expect(turns.map((t) => t.turnId)).toEqual(['u-a', 'u-b'])
  })
})