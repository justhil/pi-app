import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { getTimelineScrollEl } from './timeline-scroll-bridge'
import { requestTimelineViewEntry } from './timeline-view-jump'
import { activeMark, magnify, markY, nearestMark, scrubberMarks } from './timeline-scrubber-model'

/**
 * Quick navigation through the user's own messages: one mark per user message on a thin
 * rail at the right edge of the conversation. Hover previews, click/drag jumps (snapping
 * to marks), ↑/↓ on the focused rail or Alt+↑/↓ anywhere. It only moves the view — the
 * session leaf, branch and composer never change.
 */
function TimelineScrubberImpl() {
  const { t } = useTranslation()
  const items = useUIStore((s) => s.timelineItems)
  const marks = useMemo(() => scrubberMarks(items), [items])
  const railRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  // Pointer position on the rail: marks near it grow (hover magnet), farther ones fade back.
  const [pointerY, setPointerY] = useState<number | null>(null)
  const dragging = useRef(false)
  const lastJump = useRef(-1)
  const marksRef = useRef(marks)
  marksRef.current = marks
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const ro = new ResizeObserver(() => setHeight(rail.clientHeight))
    ro.observe(rail)
    setHeight(rail.clientHeight)
    return () => ro.disconnect()
  }, [marks.length >= 2])

  // Follow the reading position: recomputed at most once per frame. The timeline's scroll
  // container can be created or replaced after this mounts (opening an older session,
  // home → conversation), so never hold on to one element: scroll is caught at the
  // document (capture) and the size observer follows whatever container is current.
  useEffect(() => {
    let raf = 0
    let observed: Element | null = null
    const ro = new ResizeObserver(() => schedule())
    const measure = () => {
      raf = 0
      const el = getTimelineScrollEl()
      if (el !== observed) {
        ro.disconnect()
        observed = el
        if (el) for (const child of Array.from(el.children)) ro.observe(child)
      }
      const list = marksRef.current
      if (!el || list.length === 0) return
      const box = el.getBoundingClientRect()
      const tops = list.map((m) => {
        const node = el.querySelector(`[data-item-id="${CSS.escape(m.id)}"]`)
        return node ? node.getBoundingClientRect().top - box.top : null
      })
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
      const atTop = el.scrollTop <= 4
      setActive(activeMark(tops, el.clientHeight * 0.4, { atTop, atBottom }))
    }
    function schedule() {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    const onScroll = (e: Event) => {
      if (e.target === getTimelineScrollEl()) schedule()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('timeline-scroll', schedule)
    // A freshly opened session settles over a few frames (window growth, scroll to bottom).
    const settle = [0, 120, 400, 1000].map((ms) => window.setTimeout(schedule, ms))
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('timeline-scroll', schedule)
      settle.forEach((t) => window.clearTimeout(t))
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [marks])

  const jump = useCallback((i: number) => {
    const m = marksRef.current[i]
    if (!m) return
    lastJump.current = i
    setActive(i)
    requestTimelineViewEntry(m.entryId)
  }, [])

  // Alt+↑ / Alt+↓: previous / next user message from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (marksRef.current.length < 2) return
      e.preventDefault()
      const cur = activeRef.current
      const next = Math.max(0, Math.min(marksRef.current.length - 1, cur + (e.key === 'ArrowUp' ? -1 : 1)))
      if (next !== cur) jump(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump])

  if (marks.length < 2) return null

  const indexAt = (clientY: number) => {
    const rect = railRef.current!.getBoundingClientRect()
    return nearestMark(clientY - rect.top, marks.length, rect.height)
  }
  const shown = hover ?? null

  return (
    <div
      ref={railRef}
      role="slider"
      tabIndex={0}
      aria-label={t('timeline:scrubber.label')}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={marks.length}
      aria-valuenow={active + 1}
      aria-valuetext={marks[active]?.preview}
      title={t('timeline:scrubber.hint')}
      data-timeline-scrubber=""
      className="timeline-scrubber group electron-no-drag absolute right-2.5 z-[45] w-4 cursor-pointer touch-none select-none outline-none"
      onPointerMove={(e) => {
        setPointerY(e.clientY - railRef.current!.getBoundingClientRect().top)
        const i = indexAt(e.clientY)
        if (i !== hover) setHover(i)
        if (dragging.current && i !== lastJump.current) jump(i)
      }}
      onPointerLeave={() => {
        if (dragging.current) return
        setHover(null)
        setPointerY(null)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(indexAt(e.clientY))
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onKeyDown={(e) => {
        let next = -1
        if (e.key === 'ArrowUp') next = Math.max(0, active - 1)
        else if (e.key === 'ArrowDown') next = Math.min(marks.length - 1, active + 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = marks.length - 1
        else return
        e.preventDefault()
        jump(next)
      }}
      onFocus={() => setHover(active)}
      onBlur={() => setHover(null)}
    >
      {marks.map((m, i) => {
        const y = markY(i, marks.length, height)
        // Snapped mark gets the full lift; neighbours a softer one by distance.
        const lift = i === shown ? 1 : pointerY === null ? 0 : magnify(pointerY - y) * 0.6
        const base = i === active ? 0.32 : 0.13
        return (
          <span
            key={m.id}
            aria-hidden
            className="timeline-scrubber-mark absolute right-0 h-[2px] -translate-y-1/2 rounded-full"
            style={{
              top: y,
              width: (i === active ? 10 : 7) + lift * 8,
              backgroundColor: `hsl(var(--foreground) / ${Math.min(0.6, base + lift * 0.3)})`,
            }}
          />
        )
      })}
      {shown !== null && marks[shown] ? (
        <div
          className="pointer-events-none absolute right-6 w-max max-w-[260px] -translate-y-1/2 rounded-md border border-border/60 bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
          style={{ top: markY(shown, marks.length, height) }}
        >
          <div className="text-[10px] tabular-nums text-muted-foreground/60">
            {shown + 1} / {marks.length}
          </div>
          <div className="line-clamp-2 text-[11.5px] leading-[1.45] text-foreground/85">{marks[shown].preview}</div>
        </div>
      ) : null}
    </div>
  )
}

export const TimelineScrubber = memo(TimelineScrubberImpl)
