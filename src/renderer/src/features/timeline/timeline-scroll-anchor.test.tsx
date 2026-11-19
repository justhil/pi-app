// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureViewportAnchor,
  restoreViewportAnchor,
  startAnchorSettleGuard,
} from './timeline-scroll-anchor'
import { nextTurnWindowStep } from './timeline-render-segments'

describe('timeline-scroll-anchor', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('captures the first visible [data-item-id] and restores scrollTop to 0px visual drift after prepend', () => {
    const scrollEl = document.createElement('div')
    const rowOffscreen = document.createElement('div')
    rowOffscreen.dataset.itemId = 'old-0'
    const rowVisible = document.createElement('div')
    rowVisible.dataset.itemId = 'anchor-1'
    scrollEl.append(rowOffscreen, rowVisible)
    document.body.appendChild(scrollEl)

    let scrollTop = 200
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v
      },
      configurable: true,
    })
    Object.defineProperty(scrollEl, 'scrollHeight', { get: () => 2000, configurable: true })

    // Viewport top = 100, height = 600. rowOffscreen ends at 90 (above viewport), rowVisible is at top=124 (offset +24px).
    vi.spyOn(scrollEl, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 700,
      height: 600,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(rowOffscreen, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 90,
      height: 80,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect)

    let anchorVisualTop = 124
    vi.spyOn(rowVisible, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top: anchorVisualTop,
          bottom: anchorVisualTop + 60,
          height: 60,
          left: 0,
          right: 800,
          width: 800,
          x: 0,
          y: anchorVisualTop,
          toJSON: () => ({}),
        }) as DOMRect,
    )

    const anchor = captureViewportAnchor(scrollEl)
    expect(anchor.itemId).toBe('anchor-1')
    expect(anchor.offsetTop).toBe(24)

    // Simulate prepending 1400px of older messages above anchor-1 (pushing anchor-1 down to top=1524).
    anchorVisualTop = 1524
    const usedElement = restoreViewportAnchor(scrollEl, anchor)
    expect(usedElement).toBe(true)
    expect(scrollTop).toBe(1600) // 200 + 1400 => exact 0px visual drift!
  })

  it('absorbs async above-viewport growth via ResizeObserver and immediately disarms on user wheel', () => {
    const roRef: { current: ResizeObserverCallback | null } = { current: null }
    const disconnect = vi.fn()
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roRef.current = cb
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect
    }

    const scrollEl = document.createElement('div')
    const contentEl = document.createElement('div')
    const row = document.createElement('div')
    row.dataset.itemId = 'a-1'
    contentEl.appendChild(row)
    scrollEl.appendChild(contentEl)
    document.body.appendChild(scrollEl)

    let scrollTop = 1000
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v
      },
      configurable: true,
    })

    vi.spyOn(scrollEl, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    let rowTop = 30
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top: rowTop,
          bottom: rowTop + 50,
          height: 50,
          left: 0,
          right: 800,
          width: 800,
          x: 0,
          y: rowTop,
          toJSON: () => ({}),
        }) as DOMRect,
    )

    const anchor = captureViewportAnchor(scrollEl)
    const cleanup = startAnchorSettleGuard(
      scrollEl,
      contentEl,
      anchor,
      () => false,
      400,
      FakeResizeObserver as unknown as typeof ResizeObserver,
    )

    // Async image/shiki above viewport expands by 120px -> pushes row down to 150
    rowTop = 150
    roRef.current?.([], {} as ResizeObserver)
    expect(scrollTop).toBe(1120)

    // User wheel immediately disarms guard so it never fights user scroll
    scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 }))
    expect(disconnect).toHaveBeenCalled()
    rowTop = 250
    roRef.current?.([], {} as ResizeObserver)
    expect(scrollTop).toBe(1120)

    cleanup()
  })

  it('adapts turn reveal step by row budget: full 10 turns for short chats, bounded turns for heavy tool turns', () => {
    // 1. Short chat: 60 turns × 2 rows = 120 rows
    const shortChat = Array.from({ length: 120 }, (_, i) => ({
      type: i % 2 === 0 ? 'user-message' : 'assistant-message',
    }))
    expect(nextTurnWindowStep(shortChat, 10, 10, 56)).toBe(20) // reveals all 10 turns (20 rows <= 56)

    // 2. Heavy coding session: 12 turns × 28 rows each
    const heavyChat: Array<{ type: string }> = []
    for (let t = 0; t < 12; t++) {
      heavyChat.push({ type: 'user-message' })
      for (let k = 0; k < 26; k++) heavyChat.push({ type: 'tool-call' })
      heavyChat.push({ type: 'assistant-message' })
    }
    // From 4 turns -> advances by 2 turns (56 rows) instead of dumping 280 rows at once!
    expect(nextTurnWindowStep(heavyChat, 4, 10, 56)).toBe(6)
  })
})
