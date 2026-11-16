import type { TimelineItem } from '@renderer/stores/ui-store'
import { markTrailingIncompleteAssistants } from '@shared/timeline-incomplete'

export function normalizeTimelineMessageText(t?: string): string {
  return (t || '').replace(/\s+/g, ' ').trim()
}

/** Pending 匹配，或尚未落盘的乐观用户行与 echo 同文（含带附件/图片的 payloadText）。 */
export function isReusableOptimisticUserMessage(
  item: TimelineItem | undefined,
  incomingText?: string,
  pendingText?: string | null,
): boolean {
  if (!item || item.type !== 'user-message') return false
  const lastNorm = normalizeTimelineMessageText(item.text)
  const lastPayloadNorm = normalizeTimelineMessageText(item.payloadText)
  const pendingNorm = pendingText ? normalizeTimelineMessageText(pendingText) : ''
  if (
    pendingNorm &&
    ((lastNorm && lastNorm === pendingNorm) || (lastPayloadNorm && lastPayloadNorm === pendingNorm))
  ) {
    return true
  }
  const incoming = normalizeTimelineMessageText(incomingText)
  return (
    item.id.startsWith('opt-user-') &&
    !item.sessionEntryId &&
    !!incoming &&
    (lastNorm === incoming || lastPayloadNorm === incoming)
  )
}

function userMessageMatchKey(item: TimelineItem): string {
  return normalizeTimelineMessageText(item.payloadText || item.text)
}

function mergeDuplicateUserMessage(first: TimelineItem, second: TimelineItem): TimelineItem {
  const prefer = second.sessionEntryId || !first.sessionEntryId ? second : first
  const other = prefer === first ? second : first
  const hasRichSegments = !!(prefer.segments?.length || other.segments?.length)
  const displayText = other.segments?.length
    ? other.text || prefer.text
    : prefer.text || other.text
  return {
    ...prefer,
    text: hasRichSegments ? displayText : (prefer.text || other.text),
    segments: prefer.segments?.length ? prefer.segments : other.segments,
    attachments: prefer.attachments?.length ? prefer.attachments : other.attachments,
    payloadText: prefer.payloadText || other.payloadText || (hasRichSegments ? prefer.text : undefined),
    sessionEntryId: prefer.sessionEntryId ?? other.sessionEntryId,
    runId: prefer.runId ?? other.runId,
    turnId: prefer.turnId ?? other.turnId,
  }
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
      const prevKey = userMessageMatchKey(prev)
      const currKey = userMessageMatchKey(it)
      const optimisticDuplicate =
        (it.id.startsWith('opt-user-') || prev.id.startsWith('opt-user-')) &&
        !!prevKey &&
        prevKey === currKey
      if (sameEntryId || optimisticDuplicate) {
        out[out.length - 1] = mergeDuplicateUserMessage(prev, it)
        continue
      }
    }
    out.push(it)
  }
  return out
}

/**
 * Prepend older disk history items without duplicating rows already present in `current`.
 * Deduplicates primarily by `sessionEntryId` (+ toolCallId / type for multi-row assistant
 * entries split across page boundaries), falling back to `id` when entry ids are absent.
 */
export function mergePrependedHistoryItems(
  olderItems: TimelineItem[],
  currentItems: TimelineItem[],
): { items: TimelineItem[]; addedCount: number } {
  if (olderItems.length === 0) return { items: currentItems, addedCount: 0 }
  if (currentItems.length === 0) return { items: olderItems, addedCount: olderItems.length }

  const existingIds = new Set<string>()
  const existingEntrySignatures = new Set<string>()
  const existingEntryIds = new Set<string>()
  const occurrenceInEntry = new Map<string, number>()

  const rowSignature = (row: TimelineItem, withinEntryIdx: number): string | null => {
    const entryId = row.sessionEntryId
    if (!entryId) return null
    if (row.type === 'tool-call') {
      return row.toolCallId
        ? `${entryId}:tool:${row.toolCallId}`
        : `${entryId}:tool-pos:${withinEntryIdx}:${row.toolName || ''}`
    }
    if (row.type === 'assistant-message') {
      return `${entryId}:assistant:${withinEntryIdx}`
    }
    return `${entryId}:${row.type}`
  }

  for (const row of currentItems) {
    if (row.id) existingIds.add(row.id)
    if (row.sessionEntryId) {
      existingEntryIds.add(row.sessionEntryId)
      const count = occurrenceInEntry.get(row.sessionEntryId) ?? 0
      occurrenceInEntry.set(row.sessionEntryId, count + 1)
      const sig = rowSignature(row, count)
      if (sig) existingEntrySignatures.add(sig)
    }
  }

  const olderOccurrenceInEntry = new Map<string, number>()
  const missingOlder: TimelineItem[] = []
  for (const row of olderItems) {
    if (row.sessionEntryId) {
      const count = olderOccurrenceInEntry.get(row.sessionEntryId) ?? 0
      olderOccurrenceInEntry.set(row.sessionEntryId, count + 1)
      const sig = rowSignature(row, count)
      if (sig && existingEntrySignatures.has(sig)) continue
      // Only split-boundary prefix rows of the very first existing entry may add to an existing
      // entry id; any other already-loaded entry id means the page overlapped a full turn.
      if (existingEntryIds.has(row.sessionEntryId)) {
        const firstExistingEntry = currentItems[0]?.sessionEntryId
        if (!firstExistingEntry || row.sessionEntryId !== firstExistingEntry) continue
        if (sig && existingEntrySignatures.has(sig)) continue
      }
      missingOlder.push(row)
      continue
    }
    if (row.id && existingIds.has(row.id)) continue
    missingOlder.push(row)
  }

  if (missingOlder.length === 0) return { items: currentItems, addedCount: 0 }
  const merged = dedupeAdjacentUserMessages([...missingOlder, ...currentItems])
  return { items: merged, addedCount: missingOlder.length }
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