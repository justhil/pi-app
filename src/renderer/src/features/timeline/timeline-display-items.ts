/** 将连续 tool-call 合并为展示块；工具前后的「纯思考」不打断合并，并入同一簇。 */

export type TimelineRawItem = {
  id: string
  type: string
  [key: string]: unknown
}

export type TimelineDisplayItem =
  | { kind: 'single'; item: TimelineRawItem; prevType?: string }
  | {
      kind: 'tool-group'
      groupId: string
      tools: TimelineRawItem[]
      /** 夹在工具前后的 thinking-only 助手气泡合并后的正文 */
      thinkingText?: string
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

/** 会打断 tool 簇的边界：用户消息、有正文的助手、压缩/错误/斜杠等 */
function isHardBoundary(item: TimelineRawItem): boolean {
  if (isToolCall(item) || isThinkingOnlyAssistant(item)) return false
  return true
}

function mergeThinkingTexts(items: TimelineRawItem[]): string | undefined {
  const parts: string[] = []
  for (const item of items) {
    const chunk = String(item.thinkingText ?? '').trim()
    if (chunk) parts.push(chunk)
  }
  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}

function prevTypeFromOut(out: TimelineDisplayItem[]): string | undefined {
  const prev = out[out.length - 1]
  if (!prev) return undefined
  if (prev.kind === 'single') return prev.item.type
  return 'tool-call'
}

/**
 * 从 index 起若进入「思考/工具」混合段，返回应吞入的结束下标（exclusive）。
 * 段内可含 thinking-only 与 tool-call；遇硬边界停止。
 * 若段内没有任何 tool-call，返回 null（调用方按普通 single 处理）。
 */
function findAgentClusterEnd(items: TimelineRawItem[], start: number): number | null {
  let i = start
  let toolCount = 0
  while (i < items.length) {
    const row = items[i]
    if (isToolCall(row)) {
      toolCount++
      i++
      continue
    }
    if (isThinkingOnlyAssistant(row)) {
      i++
      continue
    }
    break
  }
  if (toolCount === 0) return null
  return i
}

export function buildTimelineDisplayItems(items: TimelineRawItem[]): TimelineDisplayItem[] {
  const out: TimelineDisplayItem[] = []
  let index = 0

  while (index < items.length) {
    const item = items[index]

    // 尝试吞入「思考 + 工具」混合簇（思考可出现在工具前/中/后，只要中间无硬边界）
    if (isToolCall(item) || isThinkingOnlyAssistant(item)) {
      const clusterEnd = findAgentClusterEnd(items, index)
      if (clusterEnd != null) {
        const slice = items.slice(index, clusterEnd)
        const tools = slice.filter(isToolCall)
        const thinkingItems = slice.filter(isThinkingOnlyAssistant)
        const thinkingText = mergeThinkingTexts(thinkingItems)

        if (tools.length === 1 && !thinkingText) {
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
            thinkingText,
          })
        }
        index = clusterEnd
        continue
      }
    }

    // 硬边界或孤立思考（后面没有工具）→ 原样 single
    if (!isHardBoundary(item) && !isToolCall(item) && !isThinkingOnlyAssistant(item)) {
      // 理论上不会走到：tool/thinking 已处理，其余皆 hard
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
