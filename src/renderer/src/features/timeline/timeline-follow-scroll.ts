import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** 距底部在此范围内视为「跟播」 */
export const TIMELINE_NEAR_BOTTOM_PX = 100

export function isTimelineNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= TIMELINE_NEAR_BOTTOM_PX
}

export function scrollTimelineToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
}

/**
 * 贴底时：新消息、流式增量、内容区高度变大（工具展开等）都滚到底。
 * 用户上滑离开底部阈值后不再抢滚动，直到再次滑回底部附近。
 */
export function useTimelineLiveFollow(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  opts: {
    lastTailId?: string
    streamingAssistantId: string | null
    streamingTailLen: number
    contentEpoch: string | number
  },
) {
  const followLiveRef = useRef(true)

  const syncFollowFromScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    followLiveRef.current = isTimelineNearBottom(el)
  }, [scrollRef])

  const pinIfFollowing = useCallback(() => {
    if (!followLiveRef.current) return
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el || !followLiveRef.current) return
      scrollTimelineToBottom(el)
    })
  }, [scrollRef])

  useEffect(() => {
    pinIfFollowing()
  }, [opts.lastTailId, pinIfFollowing])

  useEffect(() => {
    pinIfFollowing()
  }, [opts.streamingAssistantId, opts.streamingTailLen, pinIfFollowing])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => {
      if (!followLiveRef.current) return
      const el = scrollRef.current
      if (!el) return
      scrollTimelineToBottom(el)
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollRef, contentRef, opts.contentEpoch, pinIfFollowing])

  return { followLiveRef, syncFollowFromScroll }
}