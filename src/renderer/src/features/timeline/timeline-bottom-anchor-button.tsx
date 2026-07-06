import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { isTimelineNearBottom } from './timeline-follow-scroll'
import { requestTimelineBottomAnchor } from './timeline-bottom-anchor'

export function TimelineBottomAnchorButton({
  scrollRef,
  followLiveRef,
  deps,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  followLiveRef: MutableRefObject<boolean>
  deps: unknown[]
}) {
  const [show, setShow] = useState(false)

  const sync = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShow(!isTimelineNearBottom(el))
  }, [scrollRef])

  useEffect(() => {
    sync()
  }, [sync, ...deps])

  if (!show) return null

  return (
    <button
      type="button"
      className={cn(
        'absolute bottom-3 left-1/2 z-20 -translate-x-1/2',
        'flex items-center gap-1 rounded-full border border-border/60 bg-[var(--bg-1)]/95 px-3 py-1.5',
        'text-[11px] text-foreground-secondary shadow-sm backdrop-blur-sm',
        'hover:bg-[var(--bg-hover)] hover:text-foreground',
      )}
      onClick={() => {
        followLiveRef.current = true
        requestTimelineBottomAnchor('jump-to-bottom')
        setShow(false)
      }}
    >
      <ChevronDown className="h-3.5 w-3.5" />
      回到底部
    </button>
  )
}