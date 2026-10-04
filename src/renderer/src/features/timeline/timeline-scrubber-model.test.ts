import { describe, expect, it } from 'vitest'
import { activeMark, magnify, markY, nearestMark, previewText, scrubberMarks } from './timeline-scrubber-model'

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
  it('groups marks compactly around the middle', () => {
    expect(markY(0, 3, 200)).toBe(88)
    expect(markY(1, 3, 200)).toBe(100)
    expect(markY(2, 3, 200)).toBe(112)
    expect(markY(0, 1, 200)).toBe(100)
  })
  it('squeezes only when the group does not fit', () => {
    expect(markY(0, 101, 112)).toBeCloseTo(6)
    expect(markY(100, 101, 112)).toBeCloseTo(106)
  })
  it('snaps a position back to the nearest mark, clamped to the ends', () => {
    expect(nearestMark(100, 3, 200)).toBe(1)
    expect(nearestMark(107, 3, 200)).toBe(2)
    expect(nearestMark(0, 3, 200)).toBe(0)
    expect(nearestMark(500, 3, 200)).toBe(2)
    expect(nearestMark(10, 0, 200)).toBe(-1)
  })
  it('magnifies marks near the pointer and fades with distance', () => {
    expect(magnify(0)).toBe(1)
    expect(magnify(11)).toBeCloseTo(0.5)
    expect(magnify(30)).toBe(0)
  })
})

describe('activeMark', () => {
  it('is the last message that started above the reading line', () => {
    expect(activeMark([-400, -20, 300, 900], 200)).toBe(1)
    expect(activeMark([50, 300], 200)).toBe(0)
  })
  it('is the last message when scrolled to the bottom, the first at the top', () => {
    // Short final reply: the last question sits below the reading line.
    expect(activeMark([-900, -300, 520], 200)).toBe(1)
    expect(activeMark([-900, -300, 520], 200, { atBottom: true })).toBe(2)
    expect(activeMark([40, 600, 1400], 200, { atTop: true })).toBe(0)
  })
  it('treats unrendered (older) messages as above the viewport', () => {
    expect(activeMark([null, null, 500], 200)).toBe(1)
    expect(activeMark([null, 100, 500], 200)).toBe(1)
  })
})
