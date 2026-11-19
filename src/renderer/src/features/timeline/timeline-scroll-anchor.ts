/**
 * Element-based viewport scroll anchoring for prepending older timeline history.
 *
 * Why element-based instead of raw `scrollHeight` diff alone:
 * 1. When older messages are prepended above the viewport, pinning the first visible
 *    `[data-item-id]` element's offset relative to the scroll viewport top keeps the
 *    exact paragraph the user is reading locked to the subpixel.
 * 2. Paired with `overflow-anchor: none` on the scroll pane, it eliminates Chromium's
 *    native scroll-anchoring double-compensation jumps.
 * 3. A short post-prepend ResizeObserver settle guard absorbs asynchronous layout growth
 *    above the viewport (e.g. decoded images, syntax highlight, markdown layout) and yields
 *    immediately on any user wheel / pointer / touch / keyboard scroll intent.
 */

export interface ViewportScrollAnchor {
  itemId: string | null
  /** anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top */
  offsetTop: number
  /** Fallback for test environments (jsdom) without layout geometry. */
  prevScrollHeight: number
  prevScrollTop: number
}

const USER_SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

export function captureViewportAnchor(
  scrollEl: HTMLElement,
  opts?: { fallbackScrollHeight?: number },
): ViewportScrollAnchor {
  const containerRect = scrollEl.getBoundingClientRect()
  const hasLayout = containerRect.height > 0
  const nodes = scrollEl.querySelectorAll<HTMLElement>('[data-item-id]')
  const prevScrollHeight = opts?.fallbackScrollHeight ?? scrollEl.scrollHeight

  let firstItemId: string | null = null
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const id = node.dataset.itemId || null
    if (!id) continue
    if (!firstItemId) firstItemId = id
    if (!hasLayout) break
    const rect = node.getBoundingClientRect()
    if (rect.height <= 0) continue
    if (rect.bottom > containerRect.top + 4) {
      return {
        itemId: id,
        offsetTop: rect.top - containerRect.top,
        prevScrollHeight,
        prevScrollTop: scrollEl.scrollTop,
      }
    }
  }

  return {
    itemId: firstItemId,
    offsetTop: 0,
    prevScrollHeight,
    prevScrollTop: scrollEl.scrollTop,
  }
}

/**
 * Restore scrollTop so the anchored element remains at its pre-prepend visual offset.
 * Returns true if geometry-based element anchoring was applied.
 */
export function restoreViewportAnchor(
  scrollEl: HTMLElement,
  anchor: ViewportScrollAnchor,
): boolean {
  const containerRect = scrollEl.getBoundingClientRect()
  if (anchor.itemId && containerRect.height > 0) {
    const el = scrollEl.querySelector<HTMLElement>(
      `[data-item-id="${escapeAttr(anchor.itemId)}"]`,
    )
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.height > 0) {
        const currentOffset = rect.top - containerRect.top
        const delta = currentOffset - anchor.offsetTop
        if (Math.abs(delta) > 0.5) {
          scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta)
        }
        return true
      }
    }
  }

  // Fallback for environments without real layout geometry (e.g. jsdom unit tests)
  const growth = scrollEl.scrollHeight - anchor.prevScrollHeight
  if (growth !== 0) {
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + growth)
  }
  return false
}

/**
 * Keep the anchored element visually stationary during a brief settle window while
 * newly prepended content above the viewport finishes async layout (images/shiki/mermaid).
 * Immediately disarms on any user scroll interaction or when `shouldAbort()` returns true.
 */
export function startAnchorSettleGuard(
  scrollEl: HTMLElement,
  contentEl: HTMLElement | null,
  anchor: ViewportScrollAnchor,
  shouldAbort: () => boolean,
  durationMs = 420,
  ResizeObserverImpl: typeof ResizeObserver | undefined =
    typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined,
): () => void {
  if (!contentEl || !anchor.itemId || scrollEl.getBoundingClientRect().height <= 0) {
    return () => {}
  }

  let active = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let ro: ResizeObserver | null = null

  const stop = () => {
    if (!active) return
    active = false
    if (timer) clearTimeout(timer)
    timer = null
    ro?.disconnect()
    ro = null
    scrollEl.removeEventListener('wheel', stop)
    scrollEl.removeEventListener('pointerdown', stop)
    scrollEl.removeEventListener('touchstart', stop)
    window.removeEventListener('keydown', onKeyDown)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (USER_SCROLL_KEYS.has(e.key)) stop()
  }

  if (ResizeObserverImpl) {
    ro = new ResizeObserverImpl(() => {
      if (!active) return
      if (shouldAbort()) {
        stop()
        return
      }
      restoreViewportAnchor(scrollEl, anchor)
    })
    ro.observe(contentEl)
  }

  scrollEl.addEventListener('wheel', stop, { passive: true })
  scrollEl.addEventListener('pointerdown', stop, { passive: true })
  scrollEl.addEventListener('touchstart', stop, { passive: true })
  window.addEventListener('keydown', onKeyDown, { passive: true })
  timer = setTimeout(stop, durationMs)

  return stop
}
