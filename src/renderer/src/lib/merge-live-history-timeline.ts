import {
  dedupeAdjacentUserMessages,
  normalizeTimelineMessageText,
  sanitizeHistoryTimeline,
} from '@renderer/lib/timeline-dedupe'
import {
  lastAssistantItem,
  pickRicherAssistantMessage,
} from '@renderer/lib/streaming-timeline-preserve'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

function lastUserIndex(items: TimelineItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'user-message') return i
  }
  return -1
}

function usersMatch(a: TimelineItem, b: TimelineItem): boolean {
  if (a.type !== 'user-message' || b.type !== 'user-message') return false
  if (a.sessionEntryId && b.sessionEntryId && a.sessionEntryId === b.sessionEntryId) return true
  return normalizeTimelineMessageText(a.text) === normalizeTimelineMessageText(b.text)
}

function countByType(items: TimelineItem[], type: TimelineItem['type']): number {
  return items.reduce((n, item) => (item.type === type ? n + 1 : n), 0)
}

function liveAfterUserIsStreamingTail(liveAfterUser: TimelineItem[]): boolean {
  if (liveAfterUser.length === 0) return true
  if (liveAfterUser.length === 1 && liveAfterUser[0].type === 'assistant-message') return true
  // tools + optional trailing assistant for the active turn
  return liveAfterUser.every((item) => item.type === 'tool-call' || item.type === 'assistant-message')
}

/**
 * JSONL tail + 内存 live cache。
 * 切出时 capture 常是「整段可见时间线」；后台只继续追加流式尾部。
 * 禁止无脑 hist+live 拼接（重复渲染）；禁止在 live 含 tool 时只保留 assistant（少渲染）。
 */
export function mergeLiveTimelineWithHistoryTail(
  historyItems: TimelineItem[],
  liveItems: TimelineItem[],
): TimelineItem[] {
  const hist = sanitizeHistoryTimeline(historyItems)
  const live = sanitizeHistoryTimeline(liveItems)
  if (live.length === 0) return hist
  if (hist.length === 0) return live

  const histUserIdx = lastUserIndex(hist)
  const liveUserIdx = lastUserIndex(live)

  // live 是切出时整页 capture（含历史），优先用更完整的一侧，避免 hist+live 双份
  if (liveUserIdx >= 0 && histUserIdx >= 0) {
    const histUser = hist[histUserIdx]
    const liveUser = live[liveUserIdx]
    if (usersMatch(histUser, liveUser)) {
      const histThroughUser = hist.slice(0, histUserIdx + 1)
      const liveThroughUser = live.slice(0, liveUserIdx + 1)
      const liveAfterUser = live.slice(liveUserIdx + 1)
      const histAfterUser = hist.slice(histUserIdx + 1)

      // live 前缀更完整（capture 了更长历史）→ 用 live 前缀 + live 尾
      if (liveThroughUser.length >= histThroughUser.length && live.length >= hist.length) {
        return dedupeAdjacentUserMessages(live)
      }

      // live 只是当前 turn 的流式尾（常见：后台 ensure 空 cache + deltas）
      if (liveUserIdx === 0 || liveThroughUser.length <= histThroughUser.length) {
        if (liveAfterUserIsStreamingTail(liveAfterUser)) {
          // live 尾有 tool，不能只用 pickRicher 丢 tool
          if (liveAfterUser.some((item) => item.type === 'tool-call')) {
            return dedupeAdjacentUserMessages([...histThroughUser, ...liveAfterUser])
          }
          const histTrailing = histAfterUser[0]
          const liveTailAsst = lastAssistantItem(liveAfterUser)
          if (
            histAfterUser.length <= 1 &&
            histTrailing?.type === 'assistant-message' &&
            liveTailAsst?.type === 'assistant-message' &&
            liveAfterUser.length <= 1
          ) {
            return dedupeAdjacentUserMessages([
              ...histThroughUser,
              pickRicherAssistantMessage(histTrailing, liveTailAsst),
            ])
          }
          if (liveAfterUser.length === 0) {
            return dedupeAdjacentUserMessages(hist)
          }
          return dedupeAdjacentUserMessages([...histThroughUser, ...liveAfterUser])
        }
      }

      // 同 turn：取「用户之后」更长的一侧
      if (liveAfterUser.length >= histAfterUser.length) {
        return dedupeAdjacentUserMessages([...histThroughUser, ...liveAfterUser])
      }
      return dedupeAdjacentUserMessages(hist)
    }
  }

  // live 无 user（仅 assistant/tool 流）→ 接到 hist 最后一轮之后，不重复整段 hist
  if (liveUserIdx < 0 && histUserIdx >= 0) {
    const histThroughUser = hist.slice(0, histUserIdx + 1)
    const histAfterUser = hist.slice(histUserIdx + 1)
    const liveAsst = lastAssistantItem(live)
    const histTrailing = histAfterUser[0]
    if (
      histAfterUser.length <= 1 &&
      histTrailing?.type === 'assistant-message' &&
      liveAsst?.type === 'assistant-message' &&
      !live.some((item) => item.type === 'tool-call')
    ) {
      return dedupeAdjacentUserMessages([
        ...histThroughUser,
        pickRicherAssistantMessage(histTrailing, liveAsst),
      ])
    }
    if (live.some((item) => item.type === 'tool-call') || live.length > histAfterUser.length) {
      return dedupeAdjacentUserMessages([...histThroughUser, ...live])
    }
    return dedupeAdjacentUserMessages(hist)
  }

  const lastHist = hist[hist.length - 1]
  const firstLive = live[0]
  if (
    lastHist?.type === 'assistant-message' &&
    firstLive?.type === 'assistant-message' &&
    !lastHist.text?.trim() &&
    !lastHist.thinkingText?.trim()
  ) {
    return dedupeAdjacentUserMessages([...hist.slice(0, -1), ...live])
  }

  // live 明显是超集（capture 整页）
  if (
    live.length >= hist.length &&
    countByType(live, 'user-message') >= countByType(hist, 'user-message')
  ) {
    return dedupeAdjacentUserMessages(live)
  }

  // 最后手段：不要 hist+live 全量拼接；磁盘权威
  return dedupeAdjacentUserMessages(hist)
}
