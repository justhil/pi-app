import type { TimelineItem } from '@renderer/stores/ui-store'
import { markTrailingIncompleteAssistants } from '@shared/timeline-incomplete'

export function normalizeTimelineMessageText(t?: string): string {
  return (t || '').replace(/\s+/g, ' ').trim()
}

/** Pending 匹配，或尚未落盘的乐观用户行与 echo 同文。 */
export function isReusableOptimisticUserMessage(
  item: TimelineItem | undefined,
  incomingText: string,
  pendingText?: string | null,
): boolean {
  if (!item || item.type !== 'user-message') return false
  const lastNorm = normalizeTimelineMessageText(item.text)
  const pendingNorm = pendingText ? normalizeTimelineMessageText(pendingText) : ''
  if (pendingNorm && lastNorm === pendingNorm) return true
  const incoming = normalizeTimelineMessageText(incomingText)
  return (
    item.id.startsWith('opt-user-') &&
    !item.sessionEntryId &&
    !!incoming &&
    lastNorm === incoming
  )
}

/** 去掉乐观占位 id，避免与 JSONL 历史叠在一起 */
export function stripOptimisticTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.filter((i) => !String(i.id).startsWith('opt-'))
}

/** 仅合并同一持久化 entry，或仍带乐观占位标识的相邻重复用户消息。 */
export function dedupeAdjacentUserMessages(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (it.type === 'user-message' && prev?.type === 'user-message') {
      const sameEntryId =
        !!it.sessionEntryId &&
        !!prev.sessionEntryId &&
        it.sessionEntryId === prev.sessionEntryId
      const optimisticDuplicate =
        (it.id.startsWith('opt-user-') || prev.id.startsWith('opt-user-')) &&
        normalizeTimelineMessageText(it.text) === normalizeTimelineMessageText(prev.text)
      if (sameEntryId || optimisticDuplicate) continue
    }
    out.push(it)
  }
  return out
}

export function sanitizeHistoryTimeline(items: TimelineItem[]): TimelineItem[] {
  // Heal crash mid-stream empty leaf so incomplete UI + rewind stay available after reopen.
  return markTrailingIncompleteAssistants(
    dedupeAdjacentUserMessages(stripOptimisticTimelineItems(items)),
  ) as TimelineItem[]
}

/**
 * 合并链路清洗：保留尚未落盘的乐观行（磁盘落后于发送时，刚发的消息只存在于 opt 行）。
 * 仅去掉空的乐观助手占位，避免其被误标为 interrupted。
 */
export function sanitizeLiveMergeTimeline(items: TimelineItem[]): TimelineItem[] {
  const kept = items.filter(
    (i) =>
      !String(i.id).startsWith('opt-asst-') || !!i.text?.trim() || !!i.thinkingText?.trim(),
  )
  return markTrailingIncompleteAssistants(dedupeAdjacentUserMessages(kept)) as TimelineItem[]
}