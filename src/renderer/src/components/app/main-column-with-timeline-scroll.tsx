import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { scrollTimelineByDelta } from '@renderer/features/timeline/timeline-scroll-bridge'
import { cn } from '@renderer/lib/utils'

/** 中间列全宽：侧边留白处滚轮也能滚动 Timeline */
export function MainColumnWithTimelineScroll({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('textarea, input, [data-composer-root]')) return
      if (scrollTimelineByDelta(e.deltaY)) {
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={ref}
      className={cn(
        'main-chat-column relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}