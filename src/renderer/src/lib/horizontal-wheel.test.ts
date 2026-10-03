import { describe, expect, it } from 'vitest'
import { wheelToHorizontal } from './horizontal-wheel'

const strip = { scrollLeft: 0, scrollWidth: 500, clientWidth: 200 }

describe('wheelToHorizontal', () => {
  it('turns vertical wheel into horizontal movement, clamped', () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 100, deltaMode: 0 }, strip)).toBe(100)
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 1000, deltaMode: 0 }, strip)).toBe(300)
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 3, deltaMode: 1 }, strip)).toBe(96)
  })
  it('consumes the event at the ends so the chat underneath does not scroll', () => {
    expect(wheelToHorizontal({ deltaX: 0, deltaY: -50, deltaMode: 0 }, strip)).toBe(0)
  })
  it('leaves trackpad swipes and non-overflowing strips alone', () => {
    expect(wheelToHorizontal({ deltaX: 40, deltaY: 5, deltaMode: 0 }, strip)).toBeNull()
    expect(wheelToHorizontal({ deltaX: 0, deltaY: 50, deltaMode: 0 }, { ...strip, scrollWidth: 200 })).toBeNull()
  })
})
