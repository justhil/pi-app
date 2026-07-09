import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'

/**
 * Distance from the true bottom at which we re-enable live follow.
 * Larger than a few tokens so stream growth doesn't immediately re-lock the user
 * after a tiny upward nudge — but still easy to re-engage by scrolling near end.
 */
export const TIMELINE_NEAR_BOTTOM_PX = 140

/**
 * Extra blank space under the last message while the agent is streaming.
 * Keep modest — only enough for a few lines of tokens to grow into.
 * (Composer dock already adds large scroll padding via CSS.)
 */
export const TIMELINE_STREAM_TAIL_PAD_PX = 72

/** Near top of the scrollport: auto-load / reveal older history */
export const TIMELINE_LOAD_OLDER_SCROLL_TOP_PX = 220

export function isTimelineNearBottom(el: HTMLElement, thresholdPx = TIMELINE_NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx
}

export function distanceFromBottom(el: HTMLElement): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
}

export function scrollTimelineToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
}

/** 布局/流式增高后双 rAF 贴底，减少 scrollHeight 未稳定时滚不到位 */
export function scheduleTimelineScrollToBottom(el: HTMLElement): void {
  requestAnimationFrame(() => {
    scrollTimelineToBottom(el)
    requestAnimationFrame(() => scrollTimelineToBottom(el))
  })
}

/**
 * Sticky-bottom follow for live stream / new messages.
 *
 * Rules (chat-app style):
 * - User scroll **up** → detach immediately (no resistance / no forced re-pin).
 * - User scroll within {@link TIMELINE_NEAR_BOTTOM_PX} of bottom → re-attach follow.
 * - While following: new tail / stream growth / content resize → pin to bottom.
 * - **Never** force-follow merely because agent is running or streaming id is set
 *   (that was the bug: made upward scroll impossible during a turn).
 */
export function useTimelineLiveFollow(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  opts: {
    lastTailId?: string
    streamingAssistantId: string | null
    streamingTailLen: number
    contentEpoch: string | number
    agentRunning?: boolean
  },
): {
  followLiveRef: MutableRefObject<boolean>
  syncFollowFromScroll: () => void
  onUserScrollIntent: (deltaY: number) => void
} {
  const followLiveRef = useRef(true)

  const syncFollowFromScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    followLiveRef.current = isTimelineNearBottom(el)
  }, [scrollRef])

  /** Immediate detach on upward gesture; downward re-evaluates near-bottom. */
  const onUserScrollIntent = useCallback(
    (deltaY: number) => {
      if (deltaY < 0) {
        followLiveRef.current = false
        return
      }
      if (deltaY > 0) {
        const el = scrollRef.current
        if (el) followLiveRef.current = isTimelineNearBottom(el)
      }
    },
    [scrollRef],
  )

  const pinIfFollowing = useCallback(() => {
    if (!followLiveRef.current) return
    const el = scrollRef.current
    if (!el) return
    scheduleTimelineScrollToBottom(el)
  }, [scrollRef])

  // New message / turn identity changed — pin only if still following
  useEffect(() => {
    pinIfFollowing()
  }, [opts.lastTailId, pinIfFollowing])

  // Stream token growth — pin only if still following (do NOT re-lock follow)
  useEffect(() => {
    pinIfFollowing()
  }, [opts.streamingAssistantId, opts.streamingTailLen, opts.agentRunning, pinIfFollowing])

  // Content height changes (tool expand, markdown layout) while following
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => {
      if (!followLiveRef.current) return
      const el = scrollRef.current
      if (!el) return
      scheduleTimelineScrollToBottom(el)
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollRef, contentRef, opts.contentEpoch])

  return { followLiveRef, syncFollowFromScroll, onUserScrollIntent }
}
