import type { TimelineItem } from '@renderer/stores/ui-store-types'
import type { TimelineDisplayItem } from './timeline-display-items'

export type TimelineTurnGroup = {
  turnId: string
  userItem: TimelineItem
  blocks: TimelineDisplayItem[]
  toolCount: number
  endedAt: number
}

export function groupDisplayBlocksByTurn(blocks: TimelineDisplayItem[]): {
  leading: TimelineDisplayItem[]
  turns: TimelineTurnGroup[]
} {
  const groups: TimelineTurnGroup[] = []
  const leading: TimelineDisplayItem[] = []
  let current: TimelineTurnGroup | null = null
  let seenUser = false

  for (const block of blocks) {
    if (block.kind === 'single' && block.item.type === 'user-message') {
      current = {
        turnId: String(block.item.sessionEntryId || block.item.id),
        userItem: block.item as unknown as TimelineItem,
        blocks: [],
        toolCount: 0,
        endedAt: Number(block.item.timestamp) || 0,
      }
      groups.push(current)
      seenUser = true
      continue
    }
    if (!current) {
      if (!seenUser) leading.push(block)
      continue
    }
    current.blocks.push(block)
    if (block.kind === 'tool-group') {
      current.toolCount += block.tools.length
    } else if (block.item.type === 'tool-call') {
      current.toolCount += 1
    }
    const rawTs = block.kind === 'single' ? block.item.timestamp : block.tools.at(-1)?.timestamp
    const ts = typeof rawTs === 'number' ? rawTs : Number(rawTs)
    if (Number.isFinite(ts)) current.endedAt = Math.max(current.endedAt, ts)
  }

  return { leading, turns: groups }
}