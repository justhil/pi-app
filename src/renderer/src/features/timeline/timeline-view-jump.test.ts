import { describe, expect, it, vi } from 'vitest'
import {
  VIEW_REVEAL_CHUNK_LIMIT,
  isTargetNewerThanStore,
  missingOlderItems,
  planViewReveal,
  requestTimelineViewEntry,
  userSentSince,
  TIMELINE_VIEW_ENTRY_EVENT,
} from './timeline-view-jump'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

const item = (id: string, sessionEntryId?: string, type: TimelineItem['type'] = 'user-message'): TimelineItem =>
  ({
    id,
    sessionEntryId: sessionEntryId ?? id,
    type,
    timestamp: 0,
  }) as TimelineItem

describe('requestTimelineViewEntry', () => {
  it('dispatches a window event carrying the entry id', () => {
    const spy = vi.fn()
    window.addEventListener(TIMELINE_VIEW_ENTRY_EVENT, spy)
    requestTimelineViewEntry('node-1')
    const event = spy.mock.calls[0]?.[0] as CustomEvent
    expect(event.detail).toEqual({ entryId: 'node-1' })
    window.removeEventListener(TIMELINE_VIEW_ENTRY_EVENT, spy)
  })
})

describe('planViewReveal', () => {
  const items = [item('a', 'entry-a'), item('b', 'entry-b'), item('c', 'entry-c', 'assistant-message')]

  it('drops the request without a session', () => {
    expect(planViewReveal('entry-b', items, 3, null)).toEqual({ kind: 'none', reason: 'no-session' })
  })

  it('plans a load when the target is not loaded yet', () => {
    expect(planViewReveal('entry-old', items, 3, '/tmp/s.jsonl')).toEqual({
      kind: 'load',
      entryId: 'entry-old',
    })
  })

  it('plans a window expand when the target is loaded but outside the render window', () => {
    expect(planViewReveal('entry-a', items, 1, '/tmp/s.jsonl')).toEqual({
      kind: 'scroll',
      requiredRenderCount: 3,
    })
  })

  it('reports covered when the render window already includes the target', () => {
    expect(planViewReveal('entry-c', items, 3, '/tmp/s.jsonl')).toEqual({ kind: 'none', reason: 'covered' })
    expect(planViewReveal('entry-b', items, 2, '/tmp/s.jsonl')).toEqual({ kind: 'none', reason: 'covered' })
  })

  it('matches by sessionEntryId or item id', () => {
    expect(planViewReveal('entry-a', items, 3, '/tmp/s.jsonl').kind).toBe('none')
    const byItemId = items.map((it) => ({ ...it, sessionEntryId: undefined }))
    expect(planViewReveal('b', byItemId, 3, '/tmp/s.jsonl').kind).toBe('none')
  })
})

describe('missingOlderItems', () => {
  it('returns the fetched chunk when nothing is known', () => {
    const fetched = [item('a'), item('b')]
    expect(missingOlderItems(fetched, [])).toEqual(fetched)
  })

  it('drops items already present (by id or sessionEntryId) and keeps order', () => {
    const fetched = [item('a'), item('b'), item('c')]
    const existing = [item('b'), item('c')]
    expect(missingOlderItems(fetched, existing).map((it) => it.id)).toEqual(['a'])
  })

  it('returns empty for an empty chunk', () => {
    expect(missingOlderItems([], [item('a')])).toEqual([])
  })

  it('dedupes by sessionEntryId even when the projection ids differ (hist-* re-read)', () => {
    // 重读尾部时磁盘投影会给同一条目生成新的 hist-* id：按 id 去重会把
    // 已加载的条目当新增重复 prepend，必须按稳定的 sessionEntryId 去重。
    const fetched = [
      { ...item('hist-1', 'e1'), id: 'hist-1' },
      { ...item('hist-2', 'e2'), id: 'hist-2' },
      { ...item('hist-3', 'e3'), id: 'hist-3' },
    ]
    const existing = [{ ...item('hist-old-1', 'e2'), id: 'hist-old-1' }]
    const missing = missingOlderItems(fetched, existing).map((it) => it.id)
    expect(missing).toEqual(['hist-1', 'hist-3'])
  })
})

describe('isTargetNewerThanStore', () => {
  it('true when the fetched chunk already contains the loaded tail (target lies after the leaf)', () => {
    const tail = item('leaf', 'entry-leaf')
    const fetched = [item('a'), item('leaf', 'entry-leaf')]
    expect(isTargetNewerThanStore(fetched, tail)).toBe(true)
  })

  it('false when the tail is not inside the fetched chunk (target is older history)', () => {
    const tail = item('leaf', 'entry-leaf')
    const fetched = [item('a'), item('b')]
    expect(isTargetNewerThanStore(fetched, tail)).toBe(false)
  })

  it('false with no tail', () => {
    expect(isTargetNewerThanStore([item('a')], null)).toBe(false)
  })
})

describe('userSentSince', () => {
  it('true when the current tail is a different user message', () => {
    expect(userSentSince({ id: 'tail-old', type: 'assistant-message' }, { id: 'tail-new', type: 'user-message' })).toBe(true)
  })

  it('false when the tail is unchanged or not a user message', () => {
    expect(userSentSince({ id: 'tail', type: 'assistant-message' }, { id: 'tail', type: 'assistant-message' })).toBe(false)
    expect(userSentSince({ id: 'tail', type: 'assistant-message' }, { id: 'tail-2', type: 'assistant-message' })).toBe(false)
    expect(userSentSince(null, { id: 'tail-new', type: 'user-message' })).toBe(false)
  })
})

describe('VIEW_REVEAL_CHUNK_LIMIT', () => {
  it('bounds the read-only reveal fetch', () => {
    expect(VIEW_REVEAL_CHUNK_LIMIT).toBeGreaterThan(0)
    expect(VIEW_REVEAL_CHUNK_LIMIT).toBeLessThanOrEqual(400)
  })
})
