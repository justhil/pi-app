import { describe, expect, it } from 'vitest'
import { spliceFreshDiskTail } from '@renderer/lib/merge-live-history-timeline'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

function row(id: string, type: TimelineItem['type'], entry?: string, text = id): TimelineItem {
  return { id, type, text, timestamp: 0, ...(entry ? { sessionEntryId: entry } : {}) }
}

describe('spliceFreshDiskTail', () => {
  it('keeps the older loaded prefix and takes the tail from disk', () => {
    const loaded = [
      row('l1', 'user-message', 'e1'),
      row('l2', 'assistant-message', 'e2'),
      row('l3', 'user-message', 'e3'),
      row('l4', 'assistant-message', undefined, 'stale streaming'),
    ]
    const disk = [
      row('d3', 'user-message', 'e3'),
      row('d4', 'assistant-message', 'e4', 'final'),
    ]

    const result = spliceFreshDiskTail(loaded, disk)

    expect(result.items.map((item) => item.id)).toEqual(['l1', 'l2', 'd3', 'd4'])
    expect(result.prefixCount).toBe(2)
  })

  it('keeps loaded rows of an entry block the row-based page cut off', () => {
    // Disk page starts at the 2nd tool row of assistant entry e2 (assistant row + tool rows share it).
    const loaded = [
      row('l1', 'user-message', 'e1'),
      row('l2', 'assistant-message', 'e2', 'calls tools'),
      row('l3', 'tool-call', 'e2'),
      row('l4', 'tool-call', 'e2'),
    ]
    const disk = [row('d4', 'tool-call', 'e2'), row('d5', 'assistant-message', 'e5', 'done')]

    const result = spliceFreshDiskTail(loaded, disk)

    expect(result.items.map((item) => item.id)).toEqual(['l1', 'l2', 'l3', 'd4', 'd5'])
  })

  it('falls back to the disk tail when the anchor is not loaded', () => {
    const loaded = [row('l1', 'user-message', 'x1')]
    const disk = [row('d1', 'user-message', 'e1'), row('d2', 'assistant-message', 'e2')]

    expect(spliceFreshDiskTail(loaded, disk)).toEqual({ items: disk, prefixCount: 0 })
  })

  it('falls back to the disk tail when the first disk row has no identity', () => {
    const loaded = [row('l1', 'user-message', 'e1')]
    const disk = [row('d1', 'user-message'), row('d2', 'assistant-message', 'e2')]

    expect(spliceFreshDiskTail(loaded, disk)).toEqual({ items: disk, prefixCount: 0 })
  })
})
