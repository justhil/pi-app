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

/** JSONL tail + 内存 live cache：避免首次切回只剩流式尾部、上方历史被截断 */
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
  if (histUserIdx >= 0 && liveUserIdx >= 0) {
    const histUser = hist[histUserIdx]
    const liveUser = live[liveUserIdx]
    if (usersMatch(histUser, liveUser)) {
      const histThroughUser = hist.slice(0, histUserIdx + 1)
      const histTrailing = hist[histUserIdx + 1]
      const liveTailAsst = lastAssistantItem(live)
      if (histTrailing?.type === 'assistant-message' && liveTailAsst?.type === 'assistant-message') {
        return dedupeAdjacentUserMessages([
          ...histThroughUser,
          pickRicherAssistantMessage(histTrailing, liveTailAsst),
        ])
      }
      const liveAfterUser = live.slice(liveUserIdx + 1)
      return dedupeAdjacentUserMessages([...histThroughUser, ...liveAfterUser])
    }
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

  return dedupeAdjacentUserMessages([...hist, ...live])
}