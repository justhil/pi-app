import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { cn } from '@renderer/lib/utils'

function useScrollThumb(targetRef: RefObject<HTMLElement | null>) {
  const [thumb, setThumb] = useState({ topPct: 0, heightPct: 100, scrollable: false })

  const update = useCallback(() => {
    const el = targetRef.current
    if (!el || el.scrollHeight <= el.clientHeight + 1) {
      setThumb({ topPct: 0, heightPct: 100, scrollable: false })
      return
    }
    const heightPct = Math.max(8, (el.clientHeight / el.scrollHeight) * 100)
    const maxTop = 100 - heightPct
    const max = el.scrollHeight - el.clientHeight
    const topPct = max > 0 ? (el.scrollTop / max) * maxTop : 0
    setThumb({ topPct, heightPct, scrollable: true })
  }, [targetRef])

  useEffect(() => {
    update()
    const el = targetRef.current
    if (!el) return
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [update, targetRef])

  return { thumb, update }
}

/** 自绘竖向滚动条：默认隐藏，悬停淡入，可拖动滑块 */
export function OverlayScrollbarRail({
  targetRef,
  hostHover,
  className,
}: {
  targetRef: RefObject<HTMLElement | null>
  hostHover?: boolean
  className?: string
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [railHover, setRailHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)
  const { thumb, update } = useScrollThumb(targetRef)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const onScroll = () => update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetRef, update])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const el = targetRef.current
      const rail = railRef.current
      const d = dragRef.current
      if (!el || !rail || !d) return
      const maxScroll = el.scrollHeight - el.clientHeight
      if (maxScroll <= 0) return
      const railH = rail.clientHeight
      const thumbTravel = railH * (1 - thumb.heightPct / 100)
      if (thumbTravel <= 0) return
      const deltaY = e.clientY - d.startY
      const scrollDelta = (deltaY / thumbTravel) * maxScroll
      el.scrollTop = Math.max(0, Math.min(maxScroll, d.startScrollTop + scrollDelta))
      update()
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, targetRef, thumb.heightPct, update])

  const onThumbDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = targetRef.current
    if (!el) return
    dragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop }
    setDragging(true)
  }

  const onTrackDown = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).dataset.thumb === '1') return
    const el = targetRef.current
    const rail = railRef.current
    if (!el || !rail || !thumb.scrollable) return
    const rect = rail.getBoundingClientRect()
    const y = e.clientY - rect.top
    const maxScroll = el.scrollHeight - el.clientHeight
    const thumbH = (thumb.heightPct / 100) * rect.height
    const thumbTravel = rect.height - thumbH
    if (thumbTravel <= 0) return
    const center = y - thumbH / 2
    const ratio = Math.max(0, Math.min(1, center / thumbTravel))
    el.scrollTop = ratio * maxScroll
    update()
  }

  const show = (hostHover || railHover || dragging) && thumb.scrollable

  return (
    <div
      ref={railRef}
      className={cn('overlay-scrollbar-rail absolute right-0 top-0 z-[50]', className)}
      style={{ bottom: 0, width: 'var(--scrollbar-rail-hit)' }}
      onMouseEnter={() => setRailHover(true)}
      onMouseLeave={() => !dragging && setRailHover(false)}
      onMouseDown={onTrackDown}
      aria-hidden
    >
      <div
        data-thumb="1"
        role="scrollbar"
        aria-orientation="vertical"
        className={cn(
          'overlay-scrollbar-rail__thumb absolute right-0.5 cursor-grab rounded-full transition-opacity duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:cursor-grabbing',
          show ? 'opacity-100' : 'opacity-0 pointer-events-none',
          dragging && 'opacity-100 pointer-events-auto',
        )}
        style={{
          top: `${thumb.topPct}%`,
          height: `${thumb.heightPct}%`,
        }}
        onMouseDown={onThumbDown}
      />
    </div>
  )
}

/** 隐藏系统滚动条 + 右侧自绘轨道 */
export function OverlayScrollHost({
  children,
  className,
  scrollClassName,
  showRailOnHostHover,
  scrollRef: externalRef,
  onScroll,
}: {
  children: ReactNode
  className?: string
  scrollClassName?: string
  showRailOnHostHover?: boolean
  scrollRef?: RefObject<HTMLDivElement | null>
  onScroll?: () => void
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalRef ?? innerRef
  const [hostHover, setHostHover] = useState(false)

  return (
    <div
      className={cn('overlay-scroll-host relative min-h-0 min-w-0', className)}
      onMouseEnter={() => setHostHover(true)}
      onMouseLeave={() => setHostHover(false)}
    >
      <div
        ref={scrollRef}
        className={cn('overlay-scroll-pane h-full w-full overflow-y-auto overflow-x-hidden', scrollClassName)}
        onScroll={onScroll}
      >
        {children}
      </div>
      <OverlayScrollbarRail
        targetRef={scrollRef}
        hostHover={showRailOnHostHover ? hostHover : undefined}
      />
    </div>
  )
}