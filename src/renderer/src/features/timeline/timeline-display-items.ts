/**
 * Build timeline display blocks.
 *
 * Cursor-style activity segments:
 * - While a tool segment is still open (no following assistant prose yet), tools and
 *   thinking render as **flat singles** — no summary hierarchy, no nested fold.
 * - When the next assistant **prose** arrives, the preceding tools collapse into one
 *   `tool-group` summary line (screenshot-style). Prose itself never enters the group.
 */

export type TimelineRawItem = {
  id: string
  type: string
  [key: string]: unknown
}

/** Ordered node inside a sealed tool cluster (thinking / tool only). */
export type TimelineClusterChild =
  | {
      kind: 'thinking'
      id: string
      text: string
      streaming?: boolean
      startedAt?: number
      completedAt?: number
    }
  | { kind: 'tool'; item: TimelineRawItem }
  /** @deprecated prose never enters tool clusters */
  | { kind: 'prose'; id: string; text: string }

export type TimelineDisplayItem =
  | { kind: 'single'; item: TimelineRawItem; prevType?: string }
  | {
      kind: 'tool-group'
      groupId: string
      tools: TimelineRawItem[]
      children: TimelineClusterChild[]
      thinkingText?: string
      /** @deprecated */
      foldedAssistantTexts?: string[]
    }

export function isThinkingOnlyAssistant(item: TimelineRawItem): boolean {
  if (item.type !== 'assistant-message') return false
  const text = String(item.text ?? '').trim()
  if (text) return false
  return !!String(item.thinkingText ?? '').trim()
}

export function isEmptyAssistantShell(item: TimelineRawItem): boolean {
  if (item.type !== 'assistant-message') return false
  return !String(item.text ?? '').trim() && !String(item.thinkingText ?? '').trim()
}

function isToolCall(item: TimelineRawItem): boolean {
  return item.type === 'tool-call'
}

function isAssistantWithProse(item: TimelineRawItem): boolean {
  return item.type === 'assistant-message' && !!String(item.text ?? '').trim()
}

function isHardBoundary(item: TimelineRawItem): boolean {
  if (isToolCall(item)) return false
  if (item.type === 'assistant-message') {
    return isAssistantWithProse(item)
  }
  return true
}

/**
 * Thinking-only / empty shells may join an open activity slice when tools follow.
 * Prose never folds into activity.
 */
export function canFoldAssistantIntoCluster(items: TimelineRawItem[], index: number): boolean {
  const item = items[index]
  if (!item || item.type !== 'assistant-message') return false
  if (isAssistantWithProse(item)) return false
  if (!isThinkingOnlyAssistant(item) && !isEmptyAssistantShell(item)) return false
  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const next = items[cursor]
    if (isToolCall(next)) return true
    if (isHardBoundary(next)) return false
  }
  return false
}

function prevTypeFromOut(out: TimelineDisplayItem[]): string | undefined {
  const prev = out[out.length - 1]
  if (!prev) return undefined
  if (prev.kind === 'single') return prev.item.type
  return 'tool-call'
}

/**
 * Activity slice: tools + thinking/empty bridges until prose or hard boundary.
 * Returns exclusive end index, or null if no tools in the slice.
 */
function findAgentClusterEnd(items: TimelineRawItem[], start: number): number | null {
  let index = start
  let toolCount = 0
  while (index < items.length) {
    const row = items[index]
    if (isToolCall(row)) {
      toolCount++
      index++
      continue
    }
    if (isThinkingOnlyAssistant(row) || isEmptyAssistantShell(row)) {
      index++
      continue
    }
    break
  }
  if (toolCount === 0) return null
  return index
}

/**
 * Segment is sealed only when the next visible item is assistant prose.
 * Until then, tools stay flat (no summary hierarchy).
 */
export function isActivitySegmentSealed(
  items: TimelineRawItem[],
  clusterEnd: number,
): boolean {
  if (clusterEnd >= items.length) return false
  return isAssistantWithProse(items[clusterEnd])
}

function toolPhaseIsLive(item: TimelineRawItem): boolean {
  const phase = String(item.toolPhase ?? '')
  return phase === 'start' || phase === 'update'
}

export function buildClusterChildren(slice: TimelineRawItem[]): TimelineClusterChild[] {
  const children: TimelineClusterChild[] = []
  for (const row of slice) {
    if (isToolCall(row)) {
      children.push({ kind: 'tool', item: row })
      continue
    }
    if (row.type !== 'assistant-message') continue

    const thinking = String(row.thinkingText ?? '').trim()
    const prose = String(row.text ?? '').trim()
    if (prose) continue

    const startedAt = typeof row.timestamp === 'number' ? row.timestamp : undefined
    const incomplete = !!(row as { incomplete?: boolean }).incomplete
    const stopReason = String((row as { stopReason?: string }).stopReason || '')
    const trulyInterrupted =
      incomplete &&
      (stopReason === 'aborted' || stopReason === 'interrupted' || stopReason === 'error')
    const streaming =
      trulyInterrupted || (!!thinking && !!(row as { streaming?: boolean }).streaming)

    if (thinking) {
      children.push({
        kind: 'thinking',
        id: `${row.id}-think`,
        text: thinking,
        streaming,
        startedAt,
        completedAt: streaming ? undefined : startedAt,
      })
    }
  }
  return children
}

function mergeThinkingFromChildren(children: TimelineClusterChild[]): string | undefined {
  const parts = children
    .filter((child): child is Extract<TimelineClusterChild, { kind: 'thinking' }> => child.kind === 'thinking')
    .map((child) => child.text.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export function stableToolGroupId(tools: TimelineRawItem[]): string {
  return `tg-${tools[0]?.id || 'x'}`
}

function pushFlatActivitySlice(
  out: TimelineDisplayItem[],
  slice: TimelineRawItem[],
): void {
  for (const row of slice) {
    if (isEmptyAssistantShell(row) && !isThinkingOnlyAssistant(row)) {
      continue
    }
    if (isToolCall(row) || row.type === 'assistant-message') {
      out.push({
        kind: 'single',
        item: row,
        prevType: prevTypeFromOut(out),
      })
    }
  }
}

export function buildTimelineDisplayItems(items: TimelineRawItem[]): TimelineDisplayItem[] {
  const out: TimelineDisplayItem[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]

    const canStartActivity =
      isToolCall(item) ||
      isThinkingOnlyAssistant(item) ||
      isEmptyAssistantShell(item) ||
      canFoldAssistantIntoCluster(items, index)

    if (canStartActivity) {
      const clusterEnd = findAgentClusterEnd(items, index)
      if (clusterEnd != null) {
        const slice = items.slice(index, clusterEnd)
        const tools = slice.filter(isToolCall)
        if (tools.length === 0) {
          if (isEmptyAssistantShell(item) && !isThinkingOnlyAssistant(item)) {
            index++
            continue
          }
        } else {
          const sealed = isActivitySegmentSealed(items, clusterEnd)
          if (sealed) {
            // Next item is prose — collapse prior tools into one summary line.
            const children = buildClusterChildren(slice)
            out.push({
              kind: 'tool-group',
              groupId: stableToolGroupId(tools),
              tools,
              children,
              thinkingText: mergeThinkingFromChildren(children),
            })
          } else {
            // Still open: flat tools/thinking, no hierarchy (avoids flash on each new tool).
            pushFlatActivitySlice(out, slice)
          }
          index = clusterEnd
          continue
        }
      }
      if (isEmptyAssistantShell(item) && !isThinkingOnlyAssistant(item)) {
        index++
        continue
      }
    }

    out.push({
      kind: 'single',
      item,
      prevType: prevTypeFromOut(out),
    })
    index++
  }

  return out
}

export function clusterHasLiveTool(tools: TimelineRawItem[]): boolean {
  return tools.some(toolPhaseIsLive)
}
