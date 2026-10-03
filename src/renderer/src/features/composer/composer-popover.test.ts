import { describe, expect, it } from 'vitest'
import { placeAbove } from './composer-popover'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect

describe('placeAbove', () => {
  it('right-aligns above the anchor', () => {
    expect(placeAbove(rect(600, 700, 80, 24), 300, { width: 1200, height: 800 })).toEqual({ left: 380, bottom: 106, maxHeight: 686 })
  })

  it('clamps to the left viewport edge', () => {
    expect(placeAbove(rect(20, 700, 40, 24), 300, { width: 1200, height: 800 }).left).toBe(8)
  })

  it('left-aligns for start anchors and keeps the menu on screen', () => {
    expect(placeAbove(rect(100, 700, 60, 24), 300, { width: 1200, height: 800 }, 1, 'start').left).toBe(100)
    expect(placeAbove(rect(1100, 700, 60, 24), 300, { width: 1200, height: 800 }, 1, 'start').left).toBe(892)
  })

  it('converts visual px to pre-zoom px', () => {
    const p = placeAbove(rect(600, 700, 80, 24), 330, { width: 1200, height: 800 }, 1.1)
    expect(p.left).toBeCloseTo(350 / 1.1)
    expect(p.bottom).toBeCloseTo(106 / 1.1)
  })
})
