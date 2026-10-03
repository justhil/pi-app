import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { getTimelineScrollEl } from './timeline-scroll-bridge'
import { requestTimelineViewEntry } from './timeline-view-jump'
import { activeMark, markY, nearestMark, scrubberMarks } from './timeline-scrubber-model'

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

  // Follow the reading position: recomputed at most once per frame on scroll.
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const el = getTimelineScrollEl()
      const list = marksRef.current
      if (!el || list.length === 0) return
      const box = el.getBoundingClientRect()
      const tops = list.map((m) => {
        const node = el.querySelector(`[data-item-id="${CSS.escape(m.id)}"]`)
        return node ? node.getBoundingClientRect().top - box.top : null
      })
      setActive(activeMark(tops, el.clientHeight * 0.4))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    window.addEventListener('timeline-scroll', schedule)
    schedule()
    return () => {
      window.removeEventListener('timeline-scroll', schedule)
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
        const i = indexAt(e.clientY)
        if (i !== hover) setHover(i)
        if (dragging.current && i !== lastJump.current) jump(i)
      }}
      onPointerLeave={() => !dragging.current && setHover(null)}
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
      {marks.map((m, i) => (
        <span
          key={m.id}
          aria-hidden
          className={cn(
            'timeline-scrubber-mark absolute right-0 h-[2px] -translate-y-1/2 rounded-full',
            i === active ? 'w-3.5 bg-foreground/70' : i === shown ? 'w-3 bg-foreground/50' : 'w-2 bg-foreground/20 group-hover:bg-foreground/30',
          )}
          style={{ top: markY(i, marks.length, height) }}
        />
      ))}
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
