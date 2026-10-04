import { describe, expect, it } from 'vitest'
import { getIn, hasAdvanced, parseNumberInput, setIn } from './model-advanced'

describe('model advanced fields', () => {
  it('sets nested values and keeps sibling keys', () => {
    const cur = { high: { top_k: 20, min_p: 0.1 } }
    expect(setIn(cur, ['off', 'temperature'], 0.7)).toEqual({ high: { top_k: 20, min_p: 0.1 }, off: { temperature: 0.7 } })
    expect(setIn({ images: { resize: { maxWidth: 1568 } } }, ['images', 'resize', 'maxBytes'], 524288)).toEqual({
      images: { resize: { maxWidth: 1568, maxBytes: 524288 } },
    })
  })

  it('prunes objects that become empty', () => {
    expect(setIn({ images: { resize: { maxWidth: 1568 } } }, ['images', 'resize', 'maxWidth'], undefined)).toBeUndefined()
    expect(setIn({ high: { top_k: 20 }, off: { temperature: 1 } }, ['high', 'top_k'], undefined)).toEqual({ off: { temperature: 1 } })
  })

  it('reads nested values', () => {
    expect(getIn({ a: { b: 3 } }, ['a', 'b'])).toBe(3)
    expect(getIn({ a: 1 }, ['a', 'b'])).toBeUndefined()
  })

  it('parses number inputs strictly', () => {
    expect(parseNumberInput('')).toBeUndefined()
    expect(parseNumberInput(' 0.95 ')).toBe(0.95)
    expect(parseNumberInput('abc')).toBeNull()
    expect(parseNumberInput('1.5', { integer: true })).toBeNull()
    expect(parseNumberInput('101', { max: 100 })).toBeNull()
  })

  it('detects advanced fields', () => {
    expect(hasAdvanced({ id: 'x' })).toBe(false)
    expect(hasAdvanced({ id: 'x', promptCache: { short: 300 } })).toBe(true)
  })
})
