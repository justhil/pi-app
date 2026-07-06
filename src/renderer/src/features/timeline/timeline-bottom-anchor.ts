import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { isTimelineNearBottom, scrollTimelineToBottom } from './timeline-follow-scroll'

export type TimelineAnchorReason = 'session-enter' | 'message-sent' | 'jump-to-bottom' | 'resume-stream'

const ANCHOR_EVENT = 'pi-desktop:timeline-anchor'

export function requestTimelineBottomAnchor(reason: TimelineAnchorReason): void {
  window.dispatchEvent(new CustomEvent(ANCHOR_EVENT, { detail: { reason } }))
}

/**
 * Sticky-bottom controller: session enter / message sent force follow + verified scroll.
 */
export function useTimelineBottomAnchorController(
  scrollRef: RefObject<HTMLDivElement | null>,
  followLiveRef: MutableRefObject<boolean>,
  sessionKey: string | null,
) {
  const pendingVerify = useRef(0)

  const runAnchor = useCallback(
    (reason: TimelineAnchorReason) => {
      const sticky = reason === 'session-enter' || reason === 'message-sent' || reason === 'resume-stream'
      if (sticky) followLiveRef.current = true

      const attempt = (pass: number) => {
        const el = scrollRef.current
        if (!el) return
        scrollTimelineToBottom(el)
        if (pass < 2 && followLiveRef.current) {
          pendingVerify.current = window.requestAnimationFrame(() => attempt(pass + 1))
        }
      }
      if (pendingVerify.current) cancelAnimationFrame(pendingVerify.current)
      requestAnimationFrame(() => attempt(0))
    },
    [scrollRef, followLiveRef],
  )

  useEffect(() => {
    const onAnchor = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: TimelineAnchorReason }>).detail?.reason
      if (reason) runAnchor(reason)
    }
    window.addEventListener(ANCHOR_EVENT, onAnchor)
    return () => window.removeEventListener(ANCHOR_EVENT, onAnchor)
  }, [runAnchor])

  useEffect(() => {
    if (!sessionKey) return
    runAnchor('session-enter')
  }, [sessionKey, runAnchor])

  useEffect(
    () => () => {
      if (pendingVerify.current) cancelAnimationFrame(pendingVerify.current)
    },
    [],
  )
}

export function shouldDetachFromBottom(scrollEl: HTMLElement): boolean {
  return !isTimelineNearBottom(scrollEl)
}