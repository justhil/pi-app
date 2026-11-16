import {
  isInterruptedAssistantRow,
  isToolBridgeEmptyAssistant,
  type IncompleteTimelineRow,
} from '@shared/timeline-incomplete'

/**
 * Build timeline display blocks.
 *
 * Cursor-style activity segments:
 * - While the live trailing tool segment is still open, tools and thinking render as
 *   **flat singles** — no summary hierarchy, no nested fold.
 * - Once a segment is closed (by following prose, user message, compaction, abort/error,
 *   slash notice, interrupted leaf, or turn settlement), its tools and thinking collapse
 *   into one `tool-group` summary line. Prose itself never enters the group.
 */

export type TimelineRawItem = {
  id: string
  type: string
  [key: string]: unknown
}

export type BuildTimelineDisplayOptions = {
  /** True when the session has no live turn in flight, so a trailing tool-only segment can seal. */
  turnSettled?: boolean
}

/** Ordered node inside a sealed tool cluster (thinking / tool only). */
export type TimelineClusterChild =
  | {
      kind: 'thinking'
      id: string
      text: string
      streaming?: boolean
      startedAt?: number
      duration?: number
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

/**
 * Interrupted empty leaves (or error-bearing rows) render their own status/rewind UI
 * and must terminate a tool cluster rather than being swallowed into it.
 */
function isInterruptedTerminalAssistant(items: TimelineRawItem[], index: number): boolean {
  const row = items[index]
  if (!row || row.type !== 'assistant-message') return false
  if (isAssistantWithProse(row)) return false
  const errMsg = typeof row.errorMessage === 'string' ? row.errorMessage.trim() : ''
  if (errMsg) return true
  if (!isEmptyAssistantShell(row)) return false
  if (!isInterruptedAssistantRow(row as IncompleteTimelineRow)) return false
  return !isToolBridgeEmptyAssistant(items as IncompleteTimelineRow[], index)
}

function isHardBoundary(items: TimelineRawItem[], index: number): boolean {
  const item = items[index]
  if (!item) return true
  if (isToolCall(item)) return false
  if (item.type === 'assistant-message') {
    return isAssistantWithProse(item) || isInterruptedTerminalAssistant(items, index)
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
  if (isAssistantWithProse(item) || isInterruptedTerminalAssistant(items, index)) return false
  if (!isThinkingOnlyAssistant(item) && !isEmptyAssistantShell(item)) return false
  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const next = items[cursor]
    if (isToolCall(next)) return true
    if (isHardBoundary(items, cursor)) return false
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
    if (
      (isThinkingOnlyAssistant(row) || isEmptyAssistantShell(row)) &&
      !isInterruptedTerminalAssistant(items, index)
    ) {
      index++
      continue
    }
    break
  }
  if (toolCount === 0) return null
  return index
}

/**
 * Segment is sealed when closed by a boundary item (assistant prose, user message,
 * compaction, error/abort banner, slash notice, or interrupted terminal leaf), or when
 * it sits at the tail of an already-settled turn.
 */
export function isActivitySegmentSealed(
  items: TimelineRawItem[],
  clusterEnd: number,
  opts?: BuildTimelineDisplayOptions,
): boolean {
  if (clusterEnd >= items.length) return !!opts?.turnSettled
  const next = items[clusterEnd]
  return (
    isAssistantWithProse(next) ||
    isInterruptedTerminalAssistant(items, clusterEnd) ||
    next.type === 'user-message' ||
    next.type === 'compaction' ||
    next.type === 'error' ||
    next.type === 'slash'
  )
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

    if (thinking) {
      children.push({
        kind: 'thinking',
        id: `${row.id}-think`,
        text: thinking,
        streaming: false,
        startedAt,
        duration: (row as { thinkingDuration?: number }).thinkingDuration,
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
  keepTrailingShell: boolean,
): void {
  for (let at = 0; at < slice.length; at++) {
    const row = slice[at]
    if (isEmptyAssistantShell(row) && !isThinkingOnlyAssistant(row)) {
      // The live reply slot waiting for the next message stays visible (placeholder).
      if (keepTrailingShell && at === slice.length - 1) {
        out.push({ kind: 'single', item: row, prevType: prevTypeFromOut(out) })
      }
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

export function buildTimelineDisplayItems(
  items: TimelineRawItem[],
  opts?: BuildTimelineDisplayOptions,
): TimelineDisplayItem[] {
  const out: TimelineDisplayItem[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]

    const canStartActivity =
      !isInterruptedTerminalAssistant(items, index) &&
      (isToolCall(item) ||
        isThinkingOnlyAssistant(item) ||
        isEmptyAssistantShell(item) ||
        canFoldAssistantIntoCluster(items, index))

    if (canStartActivity) {
      const clusterEnd = findAgentClusterEnd(items, index)
      if (clusterEnd != null) {
        const slice = items.slice(index, clusterEnd)
        const tools = slice.filter(isToolCall)
        if (tools.length === 0) {
          if (isEmptyAssistantShell(item) && !isThinkingOnlyAssistant(item) && index < items.length - 1) {
            index++
            continue
          }
        } else {
          const next = clusterEnd < items.length ? items[clusterEnd] : null
          const hardCutByTurnEnd =
            !!opts?.turnSettled ||
            (next != null &&
              (next.type === 'user-message' ||
                next.type === 'compaction' ||
                next.type === 'error' ||
                next.type === 'slash' ||
                isInterruptedTerminalAssistant(items, clusterEnd)))
          const sealed =
            isActivitySegmentSealed(items, clusterEnd, opts) &&
            (hardCutByTurnEnd || !clusterHasLiveTool(tools))
          if (sealed) {
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
            pushFlatActivitySlice(out, slice, clusterEnd === items.length)
          }
          index = clusterEnd
          continue
        }
      }
      // Empty shells are tool bridges — except the trailing one, which is the optimistic /
      // live reply slot and must reach the renderer as a placeholder.
      if (isEmptyAssistantShell(item) && !isThinkingOnlyAssistant(item) && index < items.length - 1) {
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
