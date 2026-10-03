import { describe, expect, it } from 'vitest'
import { activeMark, markY, nearestMark, previewText, scrubberMarks } from './timeline-scrubber-model'

describe('scrubberMarks', () => {
  it('keeps only real user messages, with a one-line preview', () => {
    const marks = scrubberMarks([
      { id: 'u1', type: 'user-message', text: '  fix the\n login bug ', sessionEntryId: 'e1' },
      { id: 'a1', type: 'assistant-message', text: 'ok' },
      { id: 't1', type: 'tool-call' },
      { id: 'u2', type: 'user-message', text: '   ' },
      { id: 'u3', type: 'user-message', text: 'next' },
    ])
    expect(marks).toEqual([
      { id: 'u1', entryId: 'e1', preview: 'fix the login bug' },
      { id: 'u3', entryId: 'u3', preview: 'next' },
    ])
  })
  it('shortens long text', () => {
    expect(previewText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('rail geometry', () => {
  it('spreads marks evenly and snaps a position back to the nearest mark', () => {
    expect(markY(0, 3, 112)).toBe(6)
    expect(markY(2, 3, 112)).toBe(106)
    expect(nearestMark(50, 3, 112)).toBe(1)
    expect(nearestMark(-20, 3, 112)).toBe(0)
    expect(nearestMark(500, 3, 112)).toBe(2)
    expect(nearestMark(10, 0, 112)).toBe(-1)
  })
})

describe('activeMark', () => {
  it('is the last message that started above the reading line', () => {
    expect(activeMark([-400, -20, 300, 900], 200)).toBe(1)
    expect(activeMark([50, 300], 200)).toBe(0)
  })
  it('treats unrendered (older) messages as above the viewport', () => {
    expect(activeMark([null, null, 500], 200)).toBe(1)
    expect(activeMark([null, 100, 500], 200)).toBe(1)
  })
})
