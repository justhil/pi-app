import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

/** CSS zoom on <html> (UI scale): rects are visual px, fixed positions are pre-zoom px. */
const uiZoom = () => Number(document.documentElement.style.zoom) || 1

export interface PopoverPlacement {
  left: number
  bottom: number
  maxHeight: number
}

const GAP = 6
const EDGE = 8

/**
 * Where a menu of `width` (visual px) opens above `anchor`: right-aligned to the anchor and
 * clamped to the viewport. Returned in pre-zoom px for `position: fixed`.
 */
export function placeAbove(
  anchor: DOMRect,
  width: number,
  viewport: { width: number; height: number },
  zoom = 1,
  align: 'start' | 'end' = 'end',
): PopoverPlacement {
  const left =
    align === 'start'
      ? Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - width))
      : Math.max(EDGE, Math.min(viewport.width - EDGE, anchor.right) - width)
  const bottom = viewport.height - anchor.top + GAP
  const maxHeight = Math.max(160, anchor.top - GAP - EDGE)
  return { left: left / zoom, bottom: bottom / zoom, maxHeight: maxHeight / zoom }
}

/**
 * Menu anchored above a composer control (`anchorSelector`), no backdrop. Closes on Escape or a
 * press outside the menu and its anchor. Falls back to the composer shell when the anchor is gone
 * (e.g. opened from a slash command).
 */
export function ComposerPopover({
  anchorSelector,
  width,
  label,
  onClose,
  className,
  align = 'end',
  children,
}: {
  anchorSelector: string
  width: number
  /** Which anchor edge the menu lines up with. */
  align?: 'start' | 'end'
  label: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector(anchorSelector) ?? document.querySelector('[data-composer-shell]')
      const zoom = uiZoom()
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      if (anchor) setPlacement(placeAbove(anchor.getBoundingClientRect(), width * zoom, viewport, zoom, align))
      else setPlacement({ left: (viewport.width - width * zoom) / 2 / zoom, bottom: 120 / zoom, maxHeight: viewport.height / zoom - 160 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorSelector, width, align])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target || ref.current?.contains(target)) return
      // A press on the anchor toggles through its own click handler.
      if (target instanceof Element && target.closest(anchorSelector)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [anchorSelector, onClose])

  if (!placement) return null
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        'composer-popover fixed z-[110] flex flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground',
        className,
      )}
      style={{ left: placement.left, bottom: placement.bottom, width, maxHeight: Math.min(placement.maxHeight, 520) }}
    >
      {children}
    </div>,
    document.body,
  )
}
