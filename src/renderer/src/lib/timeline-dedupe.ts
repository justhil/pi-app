import type { TimelineItem } from '@renderer/stores/ui-store'

export function normalizeTimelineMessageText(t?: string): string {
  return (t || '').replace(/\s+/g, ' ').trim()
}

/** 去掉乐观占位 id，避免与 JSONL 历史叠在一起 */
export function stripOptimisticTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.filter((i) => !String(i.id).startsWith('opt-'))
}

/** 合并相邻、文案相同的用户消息（冷启动重复事件/历史叠加以致） */
export function dedupeAdjacentUserMessages(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (
      it.type === 'user-message' &&
      prev?.type === 'user-message' &&
      normalizeTimelineMessageText(it.text) === normalizeTimelineMessageText(prev.text)
    ) {
      continue
    }
    out.push(it)
  }
  return out
}

export function sanitizeHistoryTimeline(items: TimelineItem[]): TimelineItem[] {
  return dedupeAdjacentUserMessages(stripOptimisticTimelineItems(items))
}