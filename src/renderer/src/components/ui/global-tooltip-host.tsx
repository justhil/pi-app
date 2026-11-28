import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 320
const EDGE_PAD = 8
const GAP = 7

type Placement = 'top' | 'bottom' | 'right'

function stripAndSaveTitles(start: Element | null, stash: Set<HTMLElement>): HTMLElement | null {
  let cur: Element | null = start
  let primary: HTMLElement | null = null
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur instanceof HTMLElement) {
      const raw = cur.getAttribute('title')
      if (raw !== null) {
        if (raw.trim()) cur.dataset.piSavedTitle = raw.trim()
        cur.removeAttribute('title')
        stash.add(cur)
      }
      if (!primary && cur.dataset.piSavedTitle) primary = cur
    }
    cur = cur.parentElement
  }
  return primary
}

function restoreSavedTitles(stash: Set<HTMLElement>, keepSubtree?: Element | null): void {
  for (const el of [...stash]) {
    if (keepSubtree && (el === keepSubtree || el.contains(keepSubtree))) continue
    const saved = el.dataset.piSavedTitle
    if (saved && !el.hasAttribute('title')) el.setAttribute('title', saved)
    delete el.dataset.piSavedTitle
    stash.delete(el)
  }
}

function extractVisibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('svg, .sr-only, [aria-hidden="true"]').forEach((n) => n.remove())
  return (clone.textContent || '').replace(/\s+/g, ' ').trim()
}

function hasTruncatedDescendant(root: HTMLElement): boolean {
  if (root.scrollWidth > root.clientWidth + 2) return true
  const nodes = root.querySelectorAll<HTMLElement>('*')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) return true
  }
  return false
}

function shouldShowTooltip(anchor: HTMLElement, text: string): boolean {
  if (!text) return false
  if (anchor.dataset.piTooltipForce === 'true') return true
  const visibleText = extractVisibleText(anchor)
  if (!visibleText) return true
  return hasTruncatedDescendant(anchor)
}

function computeBubbleCoords(
  anchor: HTMLElement,
  bubble: HTMLElement,
): { left: number; top: number; placement: Placement } {
  const rect = anchor.getBoundingClientRect()
  const bw = bubble.offsetWidth
  const bh = bubble.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const inLeftRail = Boolean(anchor.closest('[data-pi-slot="left-activity-rail"]'))

  if (inLeftRail && rect.right + GAP + bw <= vw - EDGE_PAD) {
    const top = Math.max(EDGE_PAD, Math.min(rect.top + rect.height / 2 - bh / 2, vh - bh - EDGE_PAD))
    return { left: Math.round(rect.right + GAP), top: Math.round(top), placement: 'right' }
  }
  const left = Math.max(EDGE_PAD, Math.min(rect.left + rect.width / 2 - bw / 2, vw - bw - EDGE_PAD))
  if (rect.top >= bh + GAP + EDGE_PAD) {
    return { left: Math.round(left), top: Math.round(rect.top - bh - GAP), placement: 'top' }
  }
  const bottomTop = Math.min(rect.bottom + GAP, vh - bh - EDGE_PAD)
  return { left: Math.round(left), top: Math.round(Math.max(EDGE_PAD, bottomTop)), placement: 'bottom' }
}

function bindTooltipDelegation(
  stash: Set<HTMLElement>,
  onCandidate: (anchor: HTMLElement | null) => void,
  onDismiss: () => void,
): () => void {
  const onPointerOver = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null
    const anchor = stripAndSaveTitles(target, stash)
    restoreSavedTitles(stash, target)
    onCandidate(anchor)
  }
  const onPointerOut = (e: PointerEvent) => {
    if (!(e.relatedTarget instanceof Element)) {
      onDismiss()
      restoreSavedTitles(stash, null)
    }
  }
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('pointerdown', onDismiss, true)
  document.addEventListener('keydown', onDismiss, true)
  window.addEventListener('scroll', onDismiss, true)
  window.addEventListener('blur', onDismiss)
  return () => {
    restoreSavedTitles(stash, null)
    document.removeEventListener('pointerover', onPointerOver, true)
    document.removeEventListener('pointerout', onPointerOut, true)
    document.removeEventListener('pointerdown', onDismiss, true)
    document.removeEventListener('keydown', onDismiss, true)
    window.removeEventListener('scroll', onDismiss, true)
    window.removeEventListener('blur', onDismiss)
  }
}

export function GlobalTooltipHost() {
  const [active, setActive] = useState<{ anchor: HTMLElement; text: string } | null>(null)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentAnchorRef = useRef<HTMLElement | null>(null)
  const stashedRef = useRef<Set<HTMLElement>>(new Set())

  useEffect(() => {
    const clearPending = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const dismiss = () => {
      clearPending()
      currentAnchorRef.current = null
      setActive(null)
      setCoords(null)
    }
    const onCandidate = (anchor: HTMLElement | null) => {
      if (anchor === currentAnchorRef.current) return
      clearPending()
      currentAnchorRef.current = anchor
      setActive(null)
      setCoords(null)
      const text = anchor?.dataset.piSavedTitle || ''
      if (!anchor || !shouldShowTooltip(anchor, text)) return
      timerRef.current = setTimeout(() => {
        if (anchor.isConnected && anchor.getAttribute('aria-expanded') !== 'true') {
          setActive({ anchor, text })
        }
      }, SHOW_DELAY_MS)
    }
    const unbind = bindTooltipDelegation(stashedRef.current, onCandidate, dismiss)
    return () => {
      dismiss()
      unbind()
    }
  }, [])

  useLayoutEffect(() => {
    if (!active || !bubbleRef.current || !active.anchor.isConnected) return
    const next = computeBubbleCoords(active.anchor, bubbleRef.current)
    setCoords({ left: next.left, top: next.top })
  }, [active])

  if (!active) return null

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      style={{
        position: 'fixed',
        left: coords?.left ?? -9999,
        top: coords?.top ?? -9999,
        opacity: coords ? 1 : 0,
      }}
      className="pi-floating-tooltip pointer-events-none z-[9999] max-w-[300px] rounded-[10px] border border-border/75 bg-popover/95 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-popover-foreground shadow-[0_8px_24px_-4px_rgba(0,0,0,0.32)] backdrop-blur-md transition-opacity duration-150 dark:border-white/12"
    >
      {active.text}
    </div>,
    document.body,
  )
}
