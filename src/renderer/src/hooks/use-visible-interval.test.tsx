import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisibleInterval } from './use-visible-interval'

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useVisibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setHidden(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    setHidden(false)
  })

  it('runs immediately and on each tick while visible', () => {
    const tick = vi.fn()
    renderHook(() => useVisibleInterval(tick, 1000))

    expect(tick).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(tick).toHaveBeenCalledTimes(4)
  })

  // Minimized / background windows used to keep polling main every few seconds.
  it('pauses while the window is hidden and refreshes once when shown again', () => {
    const tick = vi.fn()
    renderHook(() => useVisibleInterval(tick, 1000))
    tick.mockClear()

    act(() => setHidden(true))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(tick).not.toHaveBeenCalled()

    act(() => setHidden(false))
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('stops after unmount', () => {
    const tick = vi.fn()
    const { unmount } = renderHook(() => useVisibleInterval(tick, 1000))
    tick.mockClear()
    unmount()
    act(() => {
      vi.advanceTimersByTime(5000)
      setHidden(false)
    })
    expect(tick).not.toHaveBeenCalled()
  })
})
