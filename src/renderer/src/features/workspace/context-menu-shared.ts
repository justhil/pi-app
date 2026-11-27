import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

const contextMenuItemBase =
  'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border'

export const contextMenuItemClass = `${contextMenuItemBase} text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90`

export const contextMenuDangerItemClass = `${contextMenuItemBase} text-destructive hover:bg-destructive/10 active:bg-destructive/15`

export const contextMenuPanelClass =
  'electron-no-drag fixed z-[500] min-w-[160px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg'

export type ContextMenuPosition = {
  left: number
  top: number
  maxHeight: number
}

export function getUiZoom(): number {
  if (typeof document === 'undefined') return 1
  const raw = document.documentElement.style.zoom || getComputedStyle(document.documentElement).zoom
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function measureMenuBox(el: HTMLElement, zoom: number): { width: number; height: number } {
  const rect = el.getBoundingClientRect()
  const rectW = rect.width > 0 ? rect.width / zoom : 0
  const rectH = rect.height > 0 ? rect.height / zoom : 0
  const borderY = Math.max(0, el.offsetHeight - el.clientHeight)
  const scrollH = el.scrollHeight > 0 ? el.scrollHeight + borderY : 0
  return {
    width: rectW || el.offsetWidth || 180,
    height: Math.max(rectH, scrollH) || el.offsetHeight || 160,
  }
}

export function computeContextMenuPosition(params: {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  padding?: number
}): ContextMenuPosition {
  const pad = params.padding ?? 8
  const vw = Math.max(pad * 2 + 1, params.viewportWidth)
  const vh = Math.max(pad * 2 + 1, params.viewportHeight)
  const maxHeight = Math.max(80, vh - pad * 2)
  const effectiveHeight = Math.min(params.height, maxHeight)

  let left: number
  if (params.x + params.width <= vw - pad) {
    left = params.x
  } else if (params.x - params.width >= pad) {
    left = params.x - params.width
  } else {
    left = vw - params.width - pad
  }
  left = Math.max(pad, Math.min(left, vw - params.width - pad))

  let top: number
  if (params.y + effectiveHeight <= vh - pad) {
    top = params.y
  } else if (params.y - effectiveHeight >= pad) {
    top = params.y - effectiveHeight
  } else {
    top = vh - effectiveHeight - pad
  }
  top = Math.max(pad, Math.min(top, vh - effectiveHeight - pad))

  return { left, top, maxHeight }
}

export function computeSubmenuPosition(params: {
  anchor: { left: number; right: number; top: number; bottom: number }
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  padding?: number
  overlapX?: number
  offsetY?: number
}): ContextMenuPosition {
  const pad = params.padding ?? 8
  const overlapX = params.overlapX ?? 4
  const offsetY = params.offsetY ?? 4
  const vw = Math.max(pad * 2 + 1, params.viewportWidth)
  const vh = Math.max(pad * 2 + 1, params.viewportHeight)
  const maxHeight = Math.max(80, vh - pad * 2)
  const effectiveHeight = Math.min(params.height, maxHeight)

  const rightCandidate = params.anchor.right - overlapX
  const leftCandidate = params.anchor.left - params.width + overlapX
  let left =
    rightCandidate + params.width <= vw - pad
      ? rightCandidate
      : leftCandidate >= pad
        ? leftCandidate
        : vw - params.width - pad
  left = Math.max(pad, Math.min(left, vw - params.width - pad))

  const downTop = params.anchor.top - offsetY
  const topCandidate =
    downTop + effectiveHeight <= vh - pad
      ? downTop
      : Math.min(params.anchor.bottom + offsetY - effectiveHeight, vh - effectiveHeight - pad)
  const top = Math.max(pad, Math.min(topCandidate, vh - effectiveHeight - pad))

  return { left, top, maxHeight }
}

export function useContextMenuPosition(
  anchor: { x: number; y: number } | null,
  menuRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[] = [],
): ContextMenuPosition {
  const [pos, setPos] = useState<ContextMenuPosition>(() => {
    if (!anchor) return { left: 0, top: 0, maxHeight: 480 }
    const zoom = getUiZoom()
    return {
      left: anchor.x / zoom,
      top: anchor.y / zoom,
      maxHeight: Math.max(80, window.innerHeight / zoom - 16),
    }
  })

  useLayoutEffect(() => {
    if (!anchor) return
    const el = menuRef.current
    if (!el) return
    const update = () => {
      const zoom = getUiZoom()
      const { width, height } = measureMenuBox(el, zoom)
      const next = computeContextMenuPosition({
        x: anchor.x / zoom,
        y: anchor.y / zoom,
        width,
        height,
        viewportWidth: window.innerWidth / zoom,
        viewportHeight: window.innerHeight / zoom,
      })
      setPos((prev) =>
        prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
          ? prev
          : next,
      )
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.x, anchor?.y, !!anchor, menuRef, ...deps])

  return pos
}

export function useSubmenuPosition(
  anchor: DOMRect,
  menuRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[] = [],
): ContextMenuPosition {
  const [pos, setPos] = useState<ContextMenuPosition>(() => {
    const zoom = getUiZoom()
    return {
      left: (anchor.right - 4) / zoom,
      top: (anchor.top - 4) / zoom,
      maxHeight: Math.max(80, window.innerHeight / zoom - 16),
    }
  })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const update = () => {
      const zoom = getUiZoom()
      const { width, height } = measureMenuBox(el, zoom)
      const next = computeSubmenuPosition({
        anchor: {
          left: anchor.left / zoom,
          right: anchor.right / zoom,
          top: anchor.top / zoom,
          bottom: anchor.bottom / zoom,
        },
        width,
        height,
        viewportWidth: window.innerWidth / zoom,
        viewportHeight: window.innerHeight / zoom,
      })
      setPos((prev) =>
        prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
          ? prev
          : next,
      )
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.left, anchor.right, anchor.top, anchor.bottom, menuRef, ...deps])

  return pos
}

export function computeAnchoredMenuPosition(params: {
  anchor: { left: number; right: number; top: number; bottom: number }
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  align?: 'start' | 'end'
  gap?: number
  padding?: number
}): ContextMenuPosition {
  const pad = params.padding ?? 8
  const gap = params.gap ?? 4
  const vw = Math.max(pad * 2 + 1, params.viewportWidth)
  const vh = Math.max(pad * 2 + 1, params.viewportHeight)
  const maxHeight = Math.max(80, vh - pad * 2)
  const effectiveHeight = Math.min(params.height, maxHeight)

  const rawLeft =
    params.align === 'start' ? params.anchor.left : params.anchor.right - params.width
  const left = Math.max(pad, Math.min(rawLeft, vw - params.width - pad))

  const downTop = params.anchor.bottom + gap
  const upTop = params.anchor.top - gap - effectiveHeight
  let top: number
  if (downTop + effectiveHeight <= vh - pad) {
    top = downTop
  } else if (upTop >= pad) {
    top = upTop
  } else {
    top = vh - effectiveHeight - pad
  }
  top = Math.max(pad, Math.min(top, vh - effectiveHeight - pad))

  return { left, top, maxHeight }
}

export function useAnchoredMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  options: { align?: 'start' | 'end'; gap?: number; deps?: readonly unknown[] } = {},
): ContextMenuPosition {
  const align = options.align ?? 'end'
  const gap = options.gap ?? 4
  const deps = options.deps ?? []
  const [pos, setPos] = useState<ContextMenuPosition>({ left: 8, top: 8, maxHeight: 480 })

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const update = () => {
      const zoom = getUiZoom()
      const rect = trigger.getBoundingClientRect()
      const { width, height } = measureMenuBox(menu, zoom)
      const next = computeAnchoredMenuPosition({
        anchor: {
          left: rect.left / zoom,
          right: rect.right / zoom,
          top: rect.top / zoom,
          bottom: rect.bottom / zoom,
        },
        width,
        height,
        viewportWidth: window.innerWidth / zoom,
        viewportHeight: window.innerHeight / zoom,
        align,
        gap,
      })
      setPos((prev) =>
        prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight
          ? prev
          : next,
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(menu)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triggerRef, menuRef, align, gap, ...deps])

  return pos
}

export function useDismissContextMenu(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  ignoreRef?: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const dismissIfOutside = (target: EventTarget | null) => {
      const el = ref.current
      if (!el) return
      if (target instanceof Node && (el.contains(target) || ignoreRef?.current?.contains(target))) return
      onCloseRef.current()
    }

    const onPointerDown = (e: PointerEvent) => dismissIfOutside(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    const onScroll = (e: Event) => {
      const el = ref.current
      if (!el) return
      const t = e.target
      if (t instanceof Node && el.contains(t)) return
      onCloseRef.current()
    }
    const onContextMenu = (e: MouseEvent) => dismissIfOutside(e.target)
    const onResize = () => onCloseRef.current()

    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('contextmenu', onContextMenu, true)
    }, 0)

    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)

    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, ref, ignoreRef])
}