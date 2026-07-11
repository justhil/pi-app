/** 将连续 tool-call 合并为展示块；思考与「夹在工具之间的」助手正文并入同一簇，并保留时间线顺序。 */

export type TimelineRawItem = {
  id: string
  type: string
  [key: string]: unknown
}

/** Ordered node inside a tool cluster (preserves event order). */
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
  | { kind: 'prose'; id: string; text: string }

export type TimelineDisplayItem =
  | { kind: 'single'; item: TimelineRawItem; prevType?: string }
  | {
      kind: 'tool-group'
      groupId: string
      tools: TimelineRawItem[]
      /** Timeline-ordered children (thinking / tool / mid-turn prose). */
      children: TimelineClusterChild[]
      /** @deprecated use children; kept for activity/summary consumers */
      thinkingText?: string
      /** @deprecated use children */
      foldedAssistantTexts?: string[]
    }

/** 仅有思考、无正文的助手气泡——不作为工具合并的硬边界 */
export function isThinkingOnlyAssistant(item: TimelineRawItem): boolean {
  if (item.type !== 'assistant-message') return false
  const text = String(item.text ?? '').trim()
  if (text) return false
  return !!String(item.thinkingText ?? '').trim()
}

function isToolCall(item: TimelineRawItem): boolean {
  return item.type === 'tool-call'
}

function isAssistantWithProse(item: TimelineRawItem): boolean {
  return item.type === 'assistant-message' && !!String(item.text ?? '').trim()
}

/** 会打断 tool 簇的硬边界：用户消息、压缩/错误/斜杠等（助手正文见 canFoldAssistantIntoCluster） */
function isHardBoundary(item: TimelineRawItem): boolean {
  if (isToolCall(item) || item.type === 'assistant-message') return false
  return true
}

/**
 * 助手正文仅在「后面还有 tool」时并入簇（Cursor：中间输出跟工具一起折；最终回答留在簇外）。
 */
export function canFoldAssistantIntoCluster(items: TimelineRawItem[], index: number): boolean {
  const item = items[index]
  if (!item || item.type !== 'assistant-message') return false
  if (isThinkingOnlyAssistant(item)) return true
  if (!isAssistantWithProse(item)) return false
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
 * 从 index 起吞入 tool / thinking / 可折叠助手正文，返回结束下标（exclusive）。
 * 若段内无 tool-call，返回 null。
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
    if (isThinkingOnlyAssistant(row)) {
      index++
      continue
    }
    if (canFoldAssistantIntoCluster(items, index)) {
      index++
      continue
    }
    break
  }
  if (toolCount === 0) return null
  return index
}

function toolPhaseIsLive(item: TimelineRawItem): boolean {
  const phase = String(item.toolPhase ?? '')
  return phase === 'start' || phase === 'update'
}

/** Expand a cluster slice into ordered children (thinking / tool / prose). */
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
    const startedAt = typeof row.timestamp === 'number' ? row.timestamp : undefined
    const incomplete = !!(row as { incomplete?: boolean }).incomplete
    const streaming =
      incomplete ||
      // live empty-ish assistant still streaming thinking
      (!prose && !!thinking && !!(row as { streaming?: boolean }).streaming)

    if (thinking) {
      children.push({
        kind: 'thinking',
        id: `${row.id}-think`,
        text: thinking,
        streaming: streaming && !prose,
        startedAt,
        completedAt: streaming && !prose ? undefined : startedAt,
      })
    }
    // Only fold mid-turn prose when this assistant was included because more tools follow
    // (slice membership already encodes that). Keep prose after its own thinking, before later tools.
    if (prose) {
      children.push({ kind: 'prose', id: `${row.id}-prose`, text: prose })
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

function foldProseFromChildren(children: TimelineClusterChild[]): string[] | undefined {
  const parts = children
    .filter((child): child is Extract<TimelineClusterChild, { kind: 'prose' }> => child.kind === 'prose')
    .map((child) => child.text.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

export function buildTimelineDisplayItems(items: TimelineRawItem[]): TimelineDisplayItem[] {
  const out: TimelineDisplayItem[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]

    if (isToolCall(item) || isThinkingOnlyAssistant(item) || canFoldAssistantIntoCluster(items, index)) {
      const clusterEnd = findAgentClusterEnd(items, index)
      if (clusterEnd != null) {
        const slice = items.slice(index, clusterEnd)
        const tools = slice.filter(isToolCall)
        const children = buildClusterChildren(slice)
        const thinkingText = mergeThinkingFromChildren(children)
        const foldedAssistantTexts = foldProseFromChildren(children)
        const hasNonToolChild = children.some((child) => child.kind !== 'tool')

        if (tools.length === 1 && !hasNonToolChild) {
          out.push({
            kind: 'single',
            item: tools[0],
            prevType: prevTypeFromOut(out),
          })
        } else {
          out.push({
            kind: 'tool-group',
            groupId: `tg-${tools[0].id}`,
            tools,
            children,
            thinkingText,
            foldedAssistantTexts,
          })
        }
        index = clusterEnd
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

/** Whether any tool in the cluster is still running (for group live chrome). */
export function clusterHasLiveTool(tools: TimelineRawItem[]): boolean {
  return tools.some(toolPhaseIsLive)
}
