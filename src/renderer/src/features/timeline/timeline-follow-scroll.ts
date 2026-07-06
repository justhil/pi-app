import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** 距底部在此范围内视为「跟播」 */
export const TIMELINE_NEAR_BOTTOM_PX = 100

export function isTimelineNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= TIMELINE_NEAR_BOTTOM_PX
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
    agentRunning?: boolean
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
    const el = scrollRef.current
    if (!el) return
    scheduleTimelineScrollToBottom(el)
  }, [scrollRef])

  useEffect(() => {
    if (opts.agentRunning) followLiveRef.current = true
    pinIfFollowing()
  }, [opts.lastTailId, opts.agentRunning, pinIfFollowing])

  useEffect(() => {
    if (opts.streamingAssistantId) followLiveRef.current = true
    pinIfFollowing()
  }, [opts.streamingAssistantId, opts.streamingTailLen, pinIfFollowing])

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

  return { followLiveRef, syncFollowFromScroll }
}