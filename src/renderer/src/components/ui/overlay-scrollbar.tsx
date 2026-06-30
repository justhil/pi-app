import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref,
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

function useScrollThumbH(targetRef: RefObject<HTMLElement | null>) {
  const [thumb, setThumb] = useState({ leftPct: 0, widthPct: 100, scrollable: false })

  const update = useCallback(() => {
    const el = targetRef.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) {
      setThumb({ leftPct: 0, widthPct: 100, scrollable: false })
      return
    }
    const widthPct = Math.max(8, (el.clientWidth / el.scrollWidth) * 100)
    const maxLeft = 100 - widthPct
    const max = el.scrollWidth - el.clientWidth
    const leftPct = max > 0 ? (el.scrollLeft / max) * maxLeft : 0
    setThumb({ leftPct, widthPct, scrollable: true })
  }, [targetRef])

  useEffect(() => {
    update()
    const el = targetRef.current
    if (!el) return
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    for (const child of el.children) ro.observe(child)
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
        ref={scrollRef as Ref<HTMLDivElement>}
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

/** 自绘横向滚动条 */
export function OverlayScrollbarRailH({
  targetRef,
  hostHover,
  className,
  visualOnly,
}: {
  targetRef: RefObject<HTMLElement | null>
  hostHover?: boolean
  className?: string
  /** 仅指示位置，不可点拖 */
  visualOnly?: boolean
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [railHover, setRailHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)
  const { thumb, update } = useScrollThumbH(targetRef)

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
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      const railW = rail.clientWidth
      const thumbTravel = railW * (1 - thumb.widthPct / 100)
      if (thumbTravel <= 0) return
      const deltaX = e.clientX - d.startX
      const scrollDelta = (deltaX / thumbTravel) * maxScroll
      el.scrollLeft = Math.max(0, Math.min(maxScroll, d.startScrollLeft + scrollDelta))
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
  }, [dragging, targetRef, thumb.widthPct, update])

  const onThumbDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = targetRef.current
    if (!el) return
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft }
    setDragging(true)
  }

  const onTrackDown = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).dataset.thumbH === '1') return
    const el = targetRef.current
    const rail = railRef.current
    if (!el || !rail || !thumb.scrollable) return
    const rect = rail.getBoundingClientRect()
    const x = e.clientX - rect.left
    const maxScroll = el.scrollWidth - el.clientWidth
    const thumbW = (thumb.widthPct / 100) * rect.width
    const thumbTravel = rect.width - thumbW
    if (thumbTravel <= 0) return
    const center = x - thumbW / 2
    const ratio = Math.max(0, Math.min(1, center / thumbTravel))
    el.scrollLeft = ratio * maxScroll
    update()
  }

  const show = visualOnly
    ? !!hostHover && thumb.scrollable
    : (hostHover || railHover || dragging) && thumb.scrollable

  return (
    <div
      ref={railRef}
      className={cn(
        'overlay-scrollbar-rail-h absolute bottom-0 left-0 z-[50]',
        visualOnly && 'pointer-events-none',
        className,
      )}
      style={{ right: 0, height: visualOnly ? undefined : 'var(--scrollbar-rail-hit)' }}
      onMouseEnter={visualOnly ? undefined : () => setRailHover(true)}
      onMouseLeave={visualOnly ? undefined : () => !dragging && setRailHover(false)}
      onMouseDown={visualOnly ? undefined : onTrackDown}
      aria-hidden
    >
      <div
        data-thumb-h="1"
        role="scrollbar"
        aria-orientation="horizontal"
        className={cn(
          'overlay-scrollbar-rail-h__thumb absolute rounded-full transition-opacity duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          visualOnly
            ? 'overlay-scrollbar-rail-h__thumb--hint cursor-default bottom-px'
            : 'bottom-0.5 cursor-grab active:cursor-grabbing',
          show ? (visualOnly ? 'opacity-55' : 'opacity-100') : 'opacity-0 pointer-events-none',
          !visualOnly && dragging && 'opacity-100 pointer-events-auto',
        )}
        style={{
          left: `${thumb.leftPct}%`,
          width: `${thumb.widthPct}%`,
          height: visualOnly ? undefined : 'var(--scrollbar-thumb-width)',
        }}
        onMouseDown={visualOnly ? undefined : onThumbDown}
      />
    </div>
  )
}

/** 仅横向：外层定宽滚动，内层 w-max 撑开 */
export function OverlayScrollHostX({
  children,
  className,
  innerClassName,
  showRailOnHostHover,
  scrollRef: externalRef,
  railVisualOnly,
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
  showRailOnHostHover?: boolean
  scrollRef?: RefObject<HTMLDivElement | null>
  railVisualOnly?: boolean
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const scrollRef = externalRef ?? innerRef
  const innerTrackRef = useRef<HTMLDivElement>(null)
  const [hostHover, setHostHover] = useState(false)
  const railHover = showRailOnHostHover ? hostHover : undefined

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (dx === 0) return
      el.scrollLeft += dx
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scrollRef])

  return (
    <div
      className={cn('overlay-scroll-host overlay-scroll-host--x relative min-h-0 min-w-0 overflow-hidden', className)}
      onMouseEnter={() => setHostHover(true)}
      onMouseLeave={() => setHostHover(false)}
    >
      <div
        ref={scrollRef as Ref<HTMLDivElement>}
        className="overlay-scroll-pane-x h-full w-full min-w-0 overflow-x-auto overflow-y-hidden"
      >
        <div
          ref={innerTrackRef}
          className={cn('inline-flex h-full w-max max-w-none flex-nowrap items-center', innerClassName)}
        >
          {children}
        </div>
      </div>
      <OverlayScrollbarRailH
        targetRef={scrollRef}
        hostHover={railVisualOnly ? hostHover : railHover}
        visualOnly={railVisualOnly}
      />
    </div>
  )
}

/** 纵横向均可滚：与主聊天区同款自绘轨道，可拖动 */
export function OverlayScrollHost2D({
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
  const railHover = showRailOnHostHover ? hostHover : undefined

  return (
    <div
      className={cn('overlay-scroll-host overlay-scroll-host--2d relative min-h-0 min-w-0', className)}
      onMouseEnter={() => setHostHover(true)}
      onMouseLeave={() => setHostHover(false)}
    >
      <div
        ref={scrollRef as Ref<HTMLDivElement>}
        className={cn('overlay-scroll-pane h-full w-full overflow-auto', scrollClassName)}
        onScroll={onScroll}
      >
        {children}
      </div>
      <OverlayScrollbarRail targetRef={scrollRef} hostHover={railHover} />
      <OverlayScrollbarRailH targetRef={scrollRef} hostHover={railHover} />
    </div>
  )
}