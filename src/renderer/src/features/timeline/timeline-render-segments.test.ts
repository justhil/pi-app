import { describe, expect, it } from 'vitest'
import { rowsForTurns, splitTimelineRenderSegments, sliceHistoryForViewport, turnsForRows } from './timeline-render-segments'
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
describe('turn-based window', () => {
  const u = { type: 'user-message' }
  const a = { type: 'assistant-message' }
  const t = { type: 'tool-call' }
  // preamble, then 3 turns: [u a] [u t t t a] [u a]
  const history = [a, u, a, u, t, t, t, a, u, a]

  it('counts rows covering the last N user turns, whole turns only', () => {
    expect(rowsForTurns(history, 1)).toBe(2)
    expect(rowsForTurns(history, 2)).toBe(7)
    expect(rowsForTurns(history, 3)).toBe(9)
    expect(rowsForTurns(history, 10)).toBe(10)
    expect(rowsForTurns(history, 0)).toBe(0)
  })

  it('finds how many turns include a row', () => {
    expect(turnsForRows(history, 1)).toBe(1)
    expect(turnsForRows(history, 4)).toBe(2) // a tool call inside turn 2
    expect(turnsForRows(history, 10)).toBe(4) // preamble → all turns + 1
    expect(rowsForTurns(history, turnsForRows(history, 4))).toBeGreaterThanOrEqual(4)
  })
})
