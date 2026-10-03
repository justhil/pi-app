import { describe, expect, it } from 'vitest'
import { cropRect, isDrag, placeBeside, rectFromPoints, stackLayout } from './annotation-geometry'

describe('annotation geometry', () => {
  it('normalises drag rects and separates clicks from drags', () => {
    expect(rectFromPoints(50, 40, 10, 100)).toEqual({ x: 10, y: 40, width: 40, height: 60 })
    expect(isDrag(0, 0, 3, 4)).toBe(false)
    expect(isDrag(0, 0, 6, 0)).toBe(true)
  })

  it('crops with padding, clamped to the frame and scaled to image pixels', () => {
    expect(cropRect({ x: 10, y: 10, width: 50, height: 20 }, { width: 400, height: 300 }, 2, 32)).toEqual({ x: 0, y: 0, width: 184, height: 124 })
    expect(cropRect({ x: 380, y: 290, width: 50, height: 50 }, { width: 400, height: 300 }, 1, 10)).toEqual({ x: 370, y: 280, width: 30, height: 20 })
  })

  it('stacks crops scaled to the max width', () => {
    const { width, height, placed } = stackLayout([{ width: 2000, height: 400 }, { width: 500, height: 100 }], 1000, 10, 20)
    expect(width).toBe(1000)
    expect(placed[0]).toEqual({ labelY: 0, x: 0, y: 20, width: 1000, height: 200 })
    expect(placed[1]).toEqual({ labelY: 230, x: 0, y: 250, width: 500, height: 100 })
    expect(height).toBe(350)
  })

  it('places the editor below the target, or above when there is no room', () => {
    const frame = { width: 400, height: 300 }
    expect(placeBeside({ x: 10, y: 10, width: 50, height: 20 }, { width: 200, height: 100 }, frame)).toEqual({ x: 10, y: 38 })
    expect(placeBeside({ x: 350, y: 250, width: 40, height: 20 }, { width: 200, height: 100 }, frame)).toEqual({ x: 200, y: 142 })
  })
})
