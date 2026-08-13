import { describe, expect, it } from 'vitest'
import {
  notificationBoundsLookLegal,
  notificationHostBounds,
  notificationHostSize,
} from './completion-notification-geometry'

describe('notification host geometry', () => {
  it('sizes the stack for 1-3 cards and pins it to the work-area corner', () => {
    expect(notificationHostSize(1).width).toBe(380)
    expect(notificationHostSize(3).height).toBeGreaterThan(notificationHostSize(1).height)
    expect(notificationHostSize(8)).toEqual(notificationHostSize(3))

    const bounds = notificationHostBounds({ x: 100, y: 40, width: 1200, height: 800 }, 2)
    expect(bounds.x + bounds.width).toBe(100 + 1200 - 16)
    expect(bounds.y + bounds.height).toBe(40 + 800 - 16)
    expect(notificationBoundsLookLegal(bounds, { x: 100, y: 40, width: 1200, height: 800 })).toBe(true)
  })

  it('rejects empty or NaN bounds', () => {
    expect(
      notificationBoundsLookLegal(
        { x: Number.NaN, y: 0, width: 380, height: 148 },
        { x: 0, y: 0, width: 800, height: 600 },
      ),
    ).toBe(false)
  })
})
