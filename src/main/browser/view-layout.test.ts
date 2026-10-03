import { describe, expect, it } from 'vitest'
import { computeViewBounds } from './view-layout'

const content = { width: 1600, height: 1000 }

describe('computeViewBounds', () => {
  it('hides when not visible or empty', () => {
    expect(computeViewBounds({ x: 10, y: 10, width: 100, height: 100, visible: false }, 1, content)).toBeNull()
    expect(computeViewBounds({ x: 10, y: 10, width: 0, height: 100, visible: true }, 1, content)).toBeNull()
  })

  it('scales by zoom factor and rounds', () => {
    expect(computeViewBounds({ x: 100.4, y: 50.6, width: 300, height: 200, visible: true }, 1.1, content)).toEqual({
      x: 110,
      y: 56,
      width: 330,
      height: 220,
    })
  })

  it('clamps to the content area', () => {
    expect(computeViewBounds({ x: -20, y: 900, width: 2000, height: 400, visible: true }, 1, content)).toEqual({
      x: 0,
      y: 900,
      width: 1600,
      height: 100,
    })
  })

  it('treats an invalid zoom factor as 1', () => {
    expect(computeViewBounds({ x: 1, y: 2, width: 3, height: 4, visible: true }, 0, content)).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })
})
