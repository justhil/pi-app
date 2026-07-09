import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  /** @deprecated kept for call-site compat; icon-only button */
  streaming?: boolean
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)

  const sync = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      setShow(false)
      return
    }
    // Show whenever user is not near bottom (reading history / mid-scroll)
    setShow(!isTimelineNearBottom(el))
  }, [scrollRef])

  useEffect(() => {
    sync()
  }, [sync, ...deps])

  useEffect(() => {
    const onScroll = () => sync()
    window.addEventListener('timeline-scroll', onScroll)
    // Also bind the real scrollport — more reliable than the bridged event alone
    const el = scrollRef.current
    el?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('timeline-scroll', onScroll)
      el?.removeEventListener('scroll', onScroll)
    }
  }, [sync, scrollRef, ...deps])

  if (!show) return null

  return (
    <button
      type="button"
      title={t('timeline:jumpToBottom')}
      aria-label={t('timeline:jumpToBottom')}
      className={cn(
        // Sit just above the floating composer dock (not under it).
        'pointer-events-auto absolute left-1/2 z-[60] -translate-x-1/2',
        'flex h-8 w-8 items-center justify-center rounded-full border border-border',
        'bg-[var(--bg-1)] text-foreground shadow-sm',
        'hover:bg-[var(--bg-hover)]',
        'transition-colors duration-150',
      )}
      style={{
        bottom: 'calc(var(--composer-dock-h, 11rem) + 0.75rem)',
      }}
      onClick={() => {
        followLiveRef.current = true
        requestTimelineBottomAnchor('jump-to-bottom')
        setShow(false)
      }}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  )
}
