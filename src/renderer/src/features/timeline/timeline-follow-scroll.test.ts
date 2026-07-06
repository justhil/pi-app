import { describe, expect, it } from 'vitest'
import { isTimelineNearBottom, scheduleTimelineScrollToBottom } from './timeline-follow-scroll'

describe('isTimelineNearBottom', () => {
  it('true when within threshold of bottom', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 520,
    } as HTMLElement
    expect(isTimelineNearBottom(el)).toBe(true)
  })

  it('false when scrolled up beyond threshold', () => {
    const el = {
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 400,
    } as HTMLElement
    expect(isTimelineNearBottom(el)).toBe(false)
  })
})

describe('scheduleTimelineScrollToBottom', () => {
  it('sets scrollTop to scrollHeight after animation frames', async () => {
    let top = 0
    const el = { scrollHeight: 2000 } as HTMLElement
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
})