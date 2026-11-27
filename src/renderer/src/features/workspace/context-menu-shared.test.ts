import { describe, expect, it } from 'vitest'
import {
  computeAnchoredMenuPosition,
  computeContextMenuPosition,
  computeSubmenuPosition,
} from './context-menu-shared'

describe('computeContextMenuPosition', () => {
  it('opens down-right when space is available', () => {
    expect(
      computeContextMenuPosition({
        x: 120,
        y: 200,
        width: 180,
        height: 260,
        viewportWidth: 1200,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 120, top: 200, maxHeight: 784 })
  })

  it('flips upward when right-clicking near the bottom edge (#149)', () => {
    const pos = computeContextMenuPosition({
      x: 120,
      y: 740,
      width: 180,
      height: 260,
      viewportWidth: 1200,
      viewportHeight: 800,
    })
    expect(pos.top).toBe(480)
    expect(pos.top + 260).toBeLessThanOrEqual(792)
    expect(pos.left).toBe(120)
  })

  it('flips leftward when right-clicking near the right edge', () => {
    const pos = computeContextMenuPosition({
      x: 1150,
      y: 120,
      width: 180,
      height: 200,
      viewportWidth: 1200,
      viewportHeight: 800,
    })
    expect(pos.left).toBe(970)
    expect(pos.top).toBe(120)
  })

  it('clamps inside viewport when neither above nor below fits', () => {
    const pos = computeContextMenuPosition({
      x: 100,
      y: 200,
      width: 180,
      height: 260,
      viewportWidth: 1200,
      viewportHeight: 380,
    })
    expect(pos.top).toBe(112)
    expect(pos.top + 260).toBe(372)
  })

  it('caps maxHeight and pins to top padding when menu is taller than viewport', () => {
    const pos = computeContextMenuPosition({
      x: 100,
      y: 180,
      width: 180,
      height: 360,
      viewportWidth: 1200,
      viewportHeight: 240,
    })
    expect(pos.maxHeight).toBe(224)
    expect(pos.top).toBe(8)
  })
})

describe('computeSubmenuPosition', () => {
  it('flips left and shifts up near bottom-right corner', () => {
    const pos = computeSubmenuPosition({
      anchor: { left: 980, right: 1160, top: 680, bottom: 716 },
      width: 260,
      height: 300,
      viewportWidth: 1200,
      viewportHeight: 800,
    })
    expect(pos.left).toBe(724)
    expect(pos.top).toBe(420)
    expect(pos.top + 300).toBeLessThanOrEqual(792)
  })
})

describe('computeAnchoredMenuPosition', () => {
  it('right-aligns below trigger and stays inside viewport in a narrow right dock', () => {
    const pos = computeAnchoredMenuPosition({
      anchor: { left: 1320, right: 1344, top: 300, bottom: 324 },
      width: 196,
      height: 220,
      viewportWidth: 1360,
      viewportHeight: 800,
      align: 'end',
      gap: 6,
    })
    expect(pos.left).toBe(1148)
    expect(pos.top).toBe(330)
  })

  it('flips above trigger when anchored near bottom edge', () => {
    const pos = computeAnchoredMenuPosition({
      anchor: { left: 1320, right: 1344, top: 680, bottom: 704 },
      width: 196,
      height: 220,
      viewportWidth: 1360,
      viewportHeight: 760,
      align: 'end',
      gap: 6,
    })
    expect(pos.top).toBe(454)
    expect(pos.top + 220).toBeLessThanOrEqual(752)
  })
})
