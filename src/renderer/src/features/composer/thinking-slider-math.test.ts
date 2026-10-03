import { describe, expect, it } from 'vitest'
import { nearestUsableStop, stepUsableStop } from './thinking-slider-math'

const all = [true, true, true, true, true, true, true]
const some = [true, false, true, true, true, false, false] // e.g. a model without minimal/xhigh/max

describe('thinking slider stops', () => {
  it('snaps a pointer position to the nearest stop', () => {
    expect(nearestUsableStop(0, 7, all)).toBe(0)
    expect(nearestUsableStop(0.5, 7, all)).toBe(3)
    expect(nearestUsableStop(1.4, 7, all)).toBe(6)
  })
  it('skips levels the model cannot use', () => {
    expect(nearestUsableStop(1 / 6, 7, some)).toBe(0)
    expect(nearestUsableStop(1, 7, some)).toBe(4)
    expect(nearestUsableStop(0.5, 7, [false, false, false, false, false, false, false])).toBe(-1)
  })
  it('steps between usable levels and stops at the ends', () => {
    expect(stepUsableStop(0, 1, some)).toBe(2)
    expect(stepUsableStop(4, 1, some)).toBe(4)
    expect(stepUsableStop(2, -1, some)).toBe(0)
  })
})
