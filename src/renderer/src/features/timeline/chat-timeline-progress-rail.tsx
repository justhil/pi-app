import { useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { getTimelineScrollMetrics, scrollTimelineToRatio } from './timeline-scroll-bridge'

const THUMB_PX = 32

type Placement = 'panel-edge' | 'main-column-edge'

/** 滚动进度条；panel-edge=右栏左缘，main-column-edge=右栏收起时贴主列右缘 */
export function ChatTimelineProgressRail({ placement = 'panel-edge' }: { placement?: Placement }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const paint = () => {
    rafRef.current = null
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) return
    const { progress, scrollable } = getTimelineScrollMetrics()
    track.style.visibility = scrollable ? 'visible' : 'hidden'
    track.style.pointerEvents = scrollable ? 'auto' : 'none'
    const h = track.clientHeight
    const maxY = Math.max(0, h - THUMB_PX)
    thumb.style.transform = `translate3d(0, ${progress * maxY}px, 0)`
  }

  const schedulePaint = () => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(paint)
  }

  useEffect(() => {
    const onScroll = () => schedulePaint()
    window.addEventListener('timeline-scroll', onScroll)
    paint()
    return () => {
      window.removeEventListener('timeline-scroll', onScroll)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    scrollTimelineToRatio(ratio)
    schedulePaint()
  }

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="vertical"
      className={cn(
        'chat-scroll-rail electron-no-drag w-[4px] shrink-0 cursor-pointer',
        placement === 'panel-edge' && 'h-full self-stretch',
        placement === 'main-column-edge' &&
          'chat-scroll-rail--main-column electron-no-drag pointer-events-auto absolute right-0 top-0 z-[50]',
      )}
      onClick={onTrackClick}
    >
      <div className="relative h-full w-full bg-border/25">
        <div
          ref={thumbRef}
          className={cn(
            'absolute left-0 right-0 rounded-full bg-brand/50 will-change-transform',
            'hover:bg-brand/70',
          )}
          style={{ height: THUMB_PX, top: 0 }}
        />
      </div>
    </div>
  )
}