import { describe, expect, it } from 'vitest'
import {
  TIMELINE_NEAR_BOTTOM_PX,
  TIMELINE_STREAM_TAIL_PAD_PX,
  distanceFromBottom,
  isTimelineNearBottom,
  scheduleTimelineScrollToBottom,
} from './timeline-follow-scroll'

describe('isTimelineNearBottom', () => {
  it('true when within threshold of bottom', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 1000 - 400 - (TIMELINE_NEAR_BOTTOM_PX - 10),
    } as HTMLElement
    expect(isTimelineNearBottom(el)).toBe(true)
  })

  it('false when scrolled up beyond threshold', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100,
    } as HTMLElement
    expect(isTimelineNearBottom(el)).toBe(false)
    expect(distanceFromBottom(el)).toBeGreaterThan(TIMELINE_NEAR_BOTTOM_PX)
  })
})

describe('stream tail pad constant', () => {
  it('keeps a modest blank under live stream (not a full screen gap)', () => {
    expect(TIMELINE_STREAM_TAIL_PAD_PX).toBeGreaterThanOrEqual(48)
    expect(TIMELINE_STREAM_TAIL_PAD_PX).toBeLessThanOrEqual(120)
  })
})

describe('scheduleTimelineScrollToBottom', () => {
  it('sets scrollTop to scrollHeight after animation frames', async () => {
    let top = 0
    const el = { scrollHeight: 2000, clientHeight: 400 } as HTMLElement
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v
      },
      configurable: true,
    })
    scheduleTimelineScrollToBottom(el)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(top).toBe(2000)
  })

  it('coalesces multiple schedule calls into one pin', async () => {
    let top = 0
    let writes = 0
    const el = { scrollHeight: 1500, clientHeight: 400 } as HTMLElement
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v
        writes += 1
      },
      configurable: true,
    })
    scheduleTimelineScrollToBottom(el)
    scheduleTimelineScrollToBottom(el)
    scheduleTimelineScrollToBottom(el)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(top).toBe(1500)
    // One primary pin (+ optional settle only if height changed). Coalesced callers must not
    // produce one write per schedule.
    expect(writes).toBeLessThanOrEqual(2)
  })
})
