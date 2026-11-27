// Drops pointer presses on sidebar rows that moved non-interactively (e.g. a background
// session settling or reordering above the cursor), preventing accidental clicks on neighbours.
const MOVED_ROW_PRESS_DELAY_MS = 500
const OWN_INPUT_WINDOW_MS = 500
const PRESS_FOLLOW_UPS = ['click', 'auxclick', 'dblclick', 'contextmenu'] as const

function editsText(event: KeyboardEvent): boolean {
  const target = event.target
  const editable =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  return editable && event.key !== 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey
}

function readRowTops(container: HTMLElement): Map<HTMLElement, number> {
  const tops = new Map<HTMLElement, number>()
  const rows = container.querySelectorAll<HTMLElement>('[data-sidebar-row], .sidebar-session-row, .nav-row')
  for (const row of rows) {
    tops.set(row, row.getBoundingClientRect().top)
  }
  return tops
}

export function createSidebarShiftGuard(container: HTMLElement): {
  update: () => void
  dispose: () => void
} {
  const win = container.ownerDocument.defaultView
  let tops = readRowTops(container)
  const movedAt = new WeakMap<Element, number>()
  let lastInputAt = Number.NEGATIVE_INFINITY
  const heldDrops = new Set<number>()
  let pressDropped = false
  let releasedDrop: number | null = null

  const rowOf = (target: EventTarget | null): Element | null => {
    const el = target instanceof Element ? target : null
    if (!el || !container.contains(el)) return null
    return el.closest('[data-sidebar-row], .sidebar-session-row, .nav-row')
  }

  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onPointerDown = (event: PointerEvent) => {
    heldDrops.delete(event.pointerId)
    if (releasedDrop === event.pointerId) releasedDrop = null
    const now = performance.now()
    const row = rowOf(event.target)
    const moved = row ? movedAt.get(row) : undefined
    if (moved !== undefined && now - moved < MOVED_ROW_PRESS_DELAY_MS) {
      heldDrops.add(event.pointerId)
      pressDropped = true
      swallow(event)
      return
    }
    pressDropped = false
    lastInputAt = now
  }

  const onPointerUp = (event: PointerEvent) => {
    const dropped = heldDrops.delete(event.pointerId)
    releasedDrop = dropped ? event.pointerId : null
    pressDropped = dropped
    if (dropped) {
      if (rowOf(event.target)) swallow(event)
      return
    }
    lastInputAt = performance.now()
  }

  const onPointerCancel = (event: PointerEvent) => {
    heldDrops.delete(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    pressDropped = false
    if (!editsText(event)) lastInputAt = performance.now()
  }

  const onFollowUp = (event: MouseEvent) => {
    if (event.type === 'click' && event.detail === 0) return
    const dropped =
      typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.pointerId >= 0
        ? heldDrops.has(event.pointerId) || releasedDrop === event.pointerId
        : pressDropped
    if (dropped && rowOf(event.target)) swallow(event)
  }

  win?.addEventListener('pointerdown', onPointerDown, true)
  win?.addEventListener('pointerup', onPointerUp, true)
  win?.addEventListener('pointercancel', onPointerCancel, true)
  win?.addEventListener('keydown', onKeyDown, true)
  for (const type of PRESS_FOLLOW_UPS) {
    win?.addEventListener(type, onFollowUp as EventListener, true)
  }

  return {
    update() {
      const next = readRowTops(container)
      const now = performance.now()
      const recentUserInput = now - lastInputAt < OWN_INPUT_WINDOW_MS
      if (!recentUserInput) {
        for (const [row, top] of next) {
          const prevTop = tops.get(row)
          if (prevTop !== undefined && Math.abs(prevTop - top) > 1) {
            movedAt.set(row, now)
          }
        }
      }
      tops = next
    },
    dispose() {
      win?.removeEventListener('pointerdown', onPointerDown, true)
      win?.removeEventListener('pointerup', onPointerUp, true)
      win?.removeEventListener('pointercancel', onPointerCancel, true)
      win?.removeEventListener('keydown', onKeyDown, true)
      for (const type of PRESS_FOLLOW_UPS) {
        win?.removeEventListener(type, onFollowUp as EventListener, true)
      }
    },
  }
}
