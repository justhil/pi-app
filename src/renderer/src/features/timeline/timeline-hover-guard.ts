/**
 * Intent-driven hover coordinator for the timeline:
 * 1. Scroll-Hover Suppression: while the timeline scrolls (wheel or scroll), marks the
 *    scroll container with `data-scrolling="true"` (zero React re-renders) and immediately
 *    dismisses any active hover action bar + resets stale `pointerInside` flags across rows.
 * 2. Scroll-End Pointer-Gate: after scrolling stops (140ms quiet window), hover remains
 *    suppressed until a real `mousemove` moves >= 4px so a stationary cursor never pops
 *    up action bars over text the user just stopped to read.
 * 3. Single Active Owner: only one message action bar can be visible at a time; activating
 *    a new row immediately dismisses the previous row's hide-grace timer (zero ghost trails).
 */

const SCROLL_IDLE_MS = 140
const POINTER_UNLOCK_DISTANCE_PX = 4

type DismissFn = () => void

let scrolling = false
let pointerUnlocked = true
let lockAnchor: { x: number; y: number } | null = null
let activeOwner: DismissFn | null = null
const scrollLockListeners = new Set<() => void>()

export function canActivateTimelineHover(): boolean {
  return !scrolling && pointerUnlocked
}

export function isTimelineScrolling(): boolean {
  return scrolling
}

export function dismissAllTimelineHovers(): void {
  const prev = activeOwner
  activeOwner = null
  prev?.()
}

export function claimTimelineHoverOwner(dismiss: DismissFn): void {
  if (activeOwner && activeOwner !== dismiss) {
    const prev = activeOwner
    activeOwner = dismiss
    prev()
    return
  }
  activeOwner = dismiss
}

export function releaseTimelineHoverOwner(dismiss: DismissFn): void {
  if (activeOwner === dismiss) activeOwner = null
}

export function subscribeTimelineScrollLock(listener: () => void): () => void {
  scrollLockListeners.add(listener)
  return () => {
    scrollLockListeners.delete(listener)
  }
}

/**
 * Attach scroll-suppression & pointer-gate listeners to the timeline scroll element.
 * Returns a cleanup callback for `useEffect`.
 */
export function attachTimelineScrollHoverGuard(scrollEl: HTMLElement): () => void {
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const enterScrollLock = () => {
    const firstLock = !scrolling
    if (firstLock) {
      scrolling = true
      scrollEl.dataset.scrolling = 'true'
    }
    pointerUnlocked = false
    lockAnchor = null
    dismissAllTimelineHovers()
    if (firstLock) {
      for (const fn of [...scrollLockListeners]) fn()
    }

    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      scrolling = false
      delete scrollEl.dataset.scrolling
    }, SCROLL_IDLE_MS)
  }

  const onMouseMove = (e: MouseEvent) => {
    if (scrolling || pointerUnlocked) return
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return
    if (!lockAnchor) {
      lockAnchor = { x: e.clientX, y: e.clientY }
      return
    }
    const dist = Math.hypot(e.clientX - lockAnchor.x, e.clientY - lockAnchor.y)
    if (dist >= POINTER_UNLOCK_DISTANCE_PX) {
      pointerUnlocked = true
      lockAnchor = null
    }
  }

  scrollEl.addEventListener('scroll', enterScrollLock, { passive: true })
  scrollEl.addEventListener('wheel', enterScrollLock, { passive: true })
  // Capture phase so pointer unlock completes BEFORE the target row's React onMouseMove runs.
  window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })

  return () => {
    if (idleTimer) clearTimeout(idleTimer)
    scrolling = false
    pointerUnlocked = true
    lockAnchor = null
    delete scrollEl.dataset.scrolling
    scrollEl.removeEventListener('scroll', enterScrollLock)
    scrollEl.removeEventListener('wheel', enterScrollLock)
    window.removeEventListener('mousemove', onMouseMove, { capture: true })
  }
}

/** Test-only reset helper. */
export function __resetTimelineHoverGuardForTests(): void {
  scrolling = false
  pointerUnlocked = true
  lockAnchor = null
  activeOwner = null
  scrollLockListeners.clear()
}
