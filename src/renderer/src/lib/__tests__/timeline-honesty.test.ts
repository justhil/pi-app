import { describe, expect, it } from 'vitest'
import { shouldShowTimelineHonestyBanner } from '../timeline-honesty'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

function message(id: string, entryId?: string): TimelineItem {
  return {
    id,
    type: 'user-message',
    text: id,
    timestamp: 1,
    ...(entryId ? { sessionEntryId: entryId } : {}),
  } as TimelineItem
}

describe('shouldShowTimelineHonestyBanner', () => {
  it('is false while loading or without session file', () => {
    expect(
      shouldShowTimelineHonestyBanner({
        items: [message('a', 'e1')],
        historyTotalCount: 10,
        historyLoadedCount: 1,
        historyLoading: true,
        historySessionFile: 'x.jsonl',
      }),
    ).toBe(false)
  })

  it('detects gap via detectTimelineGap entry ids', () => {
    expect(
      shouldShowTimelineHonestyBanner({
        items: [message('a', 'live-1')],
        historyTotalCount: 5,
        historyLoadedCount: 5,
        historyLoading: false,
        historySessionFile: 'x.jsonl',
        authoritativeLastEntryId: 'disk-9',
        liveFirstEntryId: 'live-1',
      }),
    ).toBe(true)
  })

  it('flags missing sessionEntryId when disk has history', () => {
    expect(
      shouldShowTimelineHonestyBanner({
        items: [message('a'), message('b')],
        historyTotalCount: 20,
        historyLoadedCount: 2,
        historyLoading: false,
        historySessionFile: 'x.jsonl',
      }),
    ).toBe(true)
  })

  it('is quiet when entry ids are dense', () => {
    expect(
      shouldShowTimelineHonestyBanner({
        items: [message('a', 'e1'), message('b', 'e2'), message('c', 'e3')],
        historyTotalCount: 3,
        historyLoadedCount: 3,
        historyLoading: false,
        historySessionFile: 'x.jsonl',
      }),
    ).toBe(false)
  })
})
