/** 将连续 tool-call 合并为展示块，减少 Timeline 占位 */

export type TimelineRawItem = {
  id: string
  type: string
  [key: string]: unknown
}

export type TimelineDisplayItem =
  | { kind: 'single'; item: TimelineRawItem; prevType?: string }
  | { kind: 'tool-group'; groupId: string; tools: TimelineRawItem[] }

export function buildTimelineDisplayItems(items: TimelineRawItem[]): TimelineDisplayItem[] {
  const out: TimelineDisplayItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item.type !== 'tool-call') {
      const prev = out[out.length - 1]
      const prevType =
        prev?.kind === 'single'
          ? prev.item.type
          : prev?.kind === 'tool-group'
            ? 'tool-call'
            : undefined
      out.push({ kind: 'single', item, prevType })
      i++
      continue
    }
    const tools: TimelineRawItem[] = []
    while (i < items.length && items[i].type === 'tool-call') {
      tools.push(items[i])
      i++
    }
    if (tools.length === 1) {
      const prev = out[out.length - 1]
      const prevType =
        prev?.kind === 'single'
          ? prev.item.type
          : prev?.kind === 'tool-group'
            ? 'tool-call'
            : undefined
      out.push({ kind: 'single', item: tools[0], prevType })
    } else {
      out.push({ kind: 'tool-group', groupId: `tg-${tools[0].id}`, tools })
    }
  }
  return out
}