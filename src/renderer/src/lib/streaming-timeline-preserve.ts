import type { TimelineItem } from '@renderer/stores/ui-store-types'

function streamChars(item: TimelineItem): number {
  if (item.type !== 'assistant-message') return 0
  return (item.text?.length ?? 0) + (item.thinkingText?.length ?? 0)
}

export function lastAssistantItem(items: TimelineItem[]): TimelineItem | null {
  const idx = lastAssistantIndex(items)
  return idx >= 0 ? items[idx] : null
}

/** 同一轮流式 assistant：保留更长的正文/思维链，避免 capture 用未 flush 的可见层盖掉 cache */
export function pickRicherAssistantMessage(a: TimelineItem, b: TimelineItem): TimelineItem {
  if (a.type !== 'assistant-message' || b.type !== 'assistant-message') {
    return streamChars(a) >= streamChars(b) ? a : b
  }
  const primary = streamChars(a) >= streamChars(b) ? a : b
  const other = primary === a ? b : a
  return {
    ...primary,
    text:
      (primary.text?.length ?? 0) >= (other.text?.length ?? 0) ? primary.text : other.text,
    thinkingText:
      (primary.thinkingText?.length ?? 0) >= (other.thinkingText?.length ?? 0)
        ? primary.thinkingText
        : other.thinkingText,
    sessionEntryId: primary.sessionEntryId ?? other.sessionEntryId,
  }
}

export function lastAssistantIndex(items: TimelineItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'assistant-message') return i
  }
  return -1
}

/** 合并两份 live cache：不依赖 assistant id（opt-asst vs cached-live） */
export function mergeLiveCacheTimelineSnapshots(
  incoming: TimelineItem[],
  existing: TimelineItem[],
): TimelineItem[] {
  if (!existing.length) return incoming.map((i) => ({ ...i }))
  if (!incoming.length) return existing.map((i) => ({ ...i }))
  const inc = incoming.map((i) => ({ ...i }))
  const ex = existing.map((i) => ({ ...i }))
  const incLast = lastAssistantIndex(inc)
  const exLast = lastAssistantIndex(ex)
  if (incLast < 0) return ex
  if (exLast < 0) return inc

  const incChars = streamChars(inc[incLast])
  const exChars = streamChars(ex[exLast])
  const base = exChars > incChars ? ex : incChars > exChars ? inc : inc.length >= ex.length ? inc : ex
  const other = base === inc ? ex : inc
  const baseLast = base === inc ? incLast : exLast
  const otherLast = other === inc ? incLast : exLast
  const richer = pickRicherAssistantMessage(base[baseLast], other[otherLast])
  return base.map((item, i) => (i === baseLast ? richer : { ...item }))
}

/** 切回合并后：用 live cache 里更长的流式正文补全最后一条 assistant */
export function applyLiveStreamingTextToMergedTimeline(
  merged: TimelineItem[],
  liveItems: TimelineItem[],
  streamingAssistantId: string | null,
): TimelineItem[] {
  const liveAsst =
    (streamingAssistantId ? liveItems.find((i) => i.id === streamingAssistantId) : undefined) ??
    lastAssistantItem(liveItems)
  if (!liveAsst || liveAsst.type !== 'assistant-message') return merged
  const idx = lastAssistantIndex(merged)
  if (idx < 0) return merged
  const richer = pickRicherAssistantMessage(merged[idx], liveAsst)
  if (
    richer.text === merged[idx].text &&
    richer.thinkingText === merged[idx].thinkingText
  ) {
    return merged
  }
  const out = [...merged]
  out[idx] = richer
  return out
}