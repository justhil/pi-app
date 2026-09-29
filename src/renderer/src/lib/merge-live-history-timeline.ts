import {
  dedupeAdjacentUserMessages,
  normalizeTimelineMessageText,
  sanitizeLiveMergeTimeline,
} from '@renderer/lib/timeline-dedupe'
import {
  assistantItemsShareTurn,
  lastAssistantItem,
  persistedTimelineEntryIds,
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
  if (a.sessionEntryId && b.sessionEntryId) {
    return a.sessionEntryId === b.sessionEntryId
  }
  return normalizeTimelineMessageText(a.text) === normalizeTimelineMessageText(b.text)
}

function countByType(items: TimelineItem[], type: TimelineItem['type']): number {
  return items.reduce((n, item) => (item.type === type ? n + 1 : n), 0)
}

function persistedIdentityPrefixesConflict(histIds: string[], liveIds: string[]): boolean {
  const compared = Math.min(histIds.length, liveIds.length)
  for (let index = 0; index < compared; index++) {
    if (histIds[index] !== liveIds[index]) return true
  }
  return false
}

function persistedIdentitySequencesConflict(histIds: string[], liveIds: string[]): boolean {
  return persistedIdentityPrefixesConflict(histIds, liveIds) || histIds.length > liveIds.length
}

function hasPersistedIdentityConflict(
  historyItems: TimelineItem[],
  liveItems: TimelineItem[],
): boolean {
  return persistedIdentitySequencesConflict(
    persistedTimelineEntryIds(historyItems),
    persistedTimelineEntryIds(liveItems),
  )
}

function liveAfterUserIsStreamingTail(liveAfterUser: TimelineItem[]): boolean {
  if (liveAfterUser.length === 0) return true
  if (liveAfterUser.length === 1 && liveAfterUser[0].type === 'assistant-message') return true
  // tools + optional trailing assistant for the active turn
  return liveAfterUser.every((item) => item.type === 'tool-call' || item.type === 'assistant-message')
}

function historyTurnMatchesUnanchoredLiveTail(
  history: TimelineItem[],
  historyUserIndex: number,
  liveTail: TimelineItem[],
): boolean {
  const historyAfterUser = history.slice(historyUserIndex + 1)
  const historyTurnId =
    historyAfterUser.find((item) => item.turnId)?.turnId ?? history[historyUserIndex]?.turnId
  if (liveTail.some((item) => item.type === 'tool-call')) {
    return (
      !!historyTurnId &&
      liveTail.length > 0 &&
      liveTail.every((item) => item.turnId === historyTurnId)
    )
  }

  const historyAssistantIndex = historyAfterUser.findIndex(
    (item) => item.type === 'assistant-message',
  )
  const liveAssistantIndex = liveTail.findIndex((item) => item.type === 'assistant-message')
  return (
    historyAssistantIndex >= 0 &&
    liveAssistantIndex >= 0 &&
    assistantItemsShareTurn(
      history,
      historyUserIndex + 1 + historyAssistantIndex,
      liveTail,
      liveAssistantIndex,
    )
  )
}

function entryBlockLength(items: TimelineItem[], start: number, entryId: string): number {
  let end = start
  while (end < items.length && items[end].sessionEntryId === entryId) end++
  return end - start
}

/**
 * 回合已结束后用新读的磁盘尾页校正已加载的时间线（#99）。
 * 磁盘对尾部是权威：锚定尾页首个持久化 entry，保留本地更早的已加载前缀，其后全部取磁盘。
 * 分页按行截断，尾页可能从某 entry 的中间行（如 tool 行）开始，此时保留本地该 entry 被截掉的前几行。
 * 锚点不在本地时退回纯磁盘尾页（与手动刷新一致）。
 */
export function spliceFreshDiskTail(
  loaded: TimelineItem[],
  diskTail: TimelineItem[],
): { items: TimelineItem[]; prefixCount: number } {
  const anchorId = diskTail[0]?.sessionEntryId
  if (!anchorId) return { items: diskTail, prefixCount: 0 }
  const loadedIdx = loaded.findIndex((item) => item.sessionEntryId === anchorId)
  if (loadedIdx < 0) return { items: diskTail, prefixCount: 0 }
  const cutRows = Math.max(
    0,
    entryBlockLength(loaded, loadedIdx, anchorId) - entryBlockLength(diskTail, 0, anchorId),
  )
  const prefix = loaded.slice(0, loadedIdx + cutRows)
  return { items: [...prefix, ...diskTail], prefixCount: prefix.length }
}

/**
 * JSONL tail + 内存 live cache。
 * 切出时 capture 常是「整段可见时间线」；后台只继续追加流式尾部。
 * 禁止无脑 hist+live 拼接（重复渲染）；禁止在 live 含 tool 时只保留 assistant（少渲染）。
 */
export function mergeLiveTimelineWithHistoryTail(
  historyItems: TimelineItem[],
  liveItems: TimelineItem[],
  persistedEntryOverlap: string[] = [],
): TimelineItem[] {
  const hist = sanitizeLiveMergeTimeline(historyItems)
  const live = sanitizeLiveMergeTimeline(liveItems)
  if (live.length === 0) return hist
  if (hist.length === 0) return live

  const histUserIdx = lastUserIndex(hist)
  const liveUserIdx = lastUserIndex(live)

  // 后台可能完成当前回答并消费 queued follow-up。此时 live 的最后用户
  // 已经领先于磁盘/切出快照，必须从持久化用户锚点接上完整 live 后缀。
  if (liveUserIdx >= 0 && histUserIdx >= 0) {
    const histUser = hist[histUserIdx]
    if (histUser.sessionEntryId) {
      const liveAnchorIdx = live.findIndex(
        (item) =>
          item.type === 'user-message' && item.sessionEntryId === histUser.sessionEntryId,
      )
      if (liveAnchorIdx >= 0 && liveAnchorIdx < liveUserIdx) {
        const histAfterAnchor = hist.slice(histUserIdx + 1)
        const liveAfterAnchor = live.slice(liveAnchorIdx + 1)
        if (!hasPersistedIdentityConflict(histAfterAnchor, liveAfterAnchor)) {
          return dedupeAdjacentUserMessages([
            ...hist.slice(0, histUserIdx + 1),
            ...liveAfterAnchor,
          ])
        }
        return dedupeAdjacentUserMessages(hist)
      }

      const overlapAnchorIdx = persistedEntryOverlap.lastIndexOf(histUser.sessionEntryId)
      if (overlapAnchorIdx >= 0) {
        const histAfterAnchorIds = persistedTimelineEntryIds(hist.slice(histUserIdx + 1))
        const liveAfterAnchorIds = [
          ...persistedEntryOverlap.slice(overlapAnchorIdx + 1),
          ...persistedTimelineEntryIds(live),
        ]
        if (!persistedIdentitySequencesConflict(histAfterAnchorIds, liveAfterAnchorIds)) {
          return dedupeAdjacentUserMessages([...hist, ...live])
        }
        return dedupeAdjacentUserMessages(hist)
      }
    }

    // live 是切出时整页 capture（含历史），优先用更完整的一侧，避免 hist+live 双份
    const liveUser = live[liveUserIdx]
    if (usersMatch(histUser, liveUser)) {
      const histThroughUser = hist.slice(0, histUserIdx + 1)
      const liveThroughUser = live.slice(0, liveUserIdx + 1)
      const liveAfterUser = live.slice(liveUserIdx + 1)
      const histAfterUser = hist.slice(histUserIdx + 1)
      if (
        persistedIdentityPrefixesConflict(
          persistedTimelineEntryIds(histAfterUser),
          persistedTimelineEntryIds(liveAfterUser),
        )
      ) {
        return dedupeAdjacentUserMessages(hist)
      }

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
    const sameTurn = historyTurnMatchesUnanchoredLiveTail(hist, histUserIdx, live)
    if (
      sameTurn &&
      histAfterUser.length <= 1 &&
      histTrailing?.type === 'assistant-message' &&
      liveAsst?.type === 'assistant-message' &&
      live.length === 1
    ) {
      return dedupeAdjacentUserMessages([
        ...histThroughUser,
        pickRicherAssistantMessage(histTrailing, liveAsst),
      ])
    }
    if (
      sameTurn &&
      (live.some((item) => item.type === 'tool-call') || live.length > histAfterUser.length)
    ) {
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

  // live 明显是超集（capture 整页）。若两侧最后用户都有持久化 identity 且冲突，
  // 说明它们不是同一轮，不能用 live 覆盖磁盘权威历史。
  const persistedLastUsersConflict =
    histUserIdx >= 0 &&
    liveUserIdx >= 0 &&
    !!hist[histUserIdx].sessionEntryId &&
    !!live[liveUserIdx].sessionEntryId &&
    hist[histUserIdx].sessionEntryId !== live[liveUserIdx].sessionEntryId
  if (
    !persistedLastUsersConflict &&
    live.length >= hist.length &&
    countByType(live, 'user-message') >= countByType(hist, 'user-message')
  ) {
    return dedupeAdjacentUserMessages(live)
  }

  // 最后手段：不要 hist+live 全量拼接；磁盘权威
  return dedupeAdjacentUserMessages(hist)
}
