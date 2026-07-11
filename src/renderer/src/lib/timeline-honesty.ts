import { detectTimelineGap } from '@shared/session-timeline-sync-plan'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { lastSessionEntryId } from '@renderer/lib/session-timeline-sync'

/**
 * Display-only honesty: after session switch / merge, timeline may lack entry ids
 * or live vs authoritative tails may disagree.
 */
export function shouldShowTimelineHonestyBanner(input: {
  items: TimelineItem[]
  historyTotalCount: number
  historyLoadedCount: number
  historyLoading: boolean
  historySessionFile: string | null
  /** Optional live cache first entry for gap detection. */
  liveFirstEntryId?: string | null
  /** Optional last authoritative entry from disk cursor. */
  authoritativeLastEntryId?: string | null
}): boolean {
  if (input.historyLoading || !input.historySessionFile) return false
  if (input.items.length === 0) return false

  if (
    detectTimelineGap({
      authoritativeLastEntryId: input.authoritativeLastEntryId,
      liveFirstEntryId: input.liveFirstEntryId,
    })
  ) {
    return true
  }

  const messageRows = input.items.filter(
    (item) => item.type === 'user-message' || item.type === 'assistant-message',
  )
  if (messageRows.length === 0) return false

  // Disk has history but no sessionEntryId on any visible message → incomplete merge.
  const anyEntryId = messageRows.some((item) => !!item.sessionEntryId)
  if (input.historyTotalCount > 0 && !anyEntryId) return true

  // Severely under-loaded relative to total while we already show a long live tail.
  if (
    input.historyTotalCount > 0 &&
    input.historyLoadedCount === 0 &&
    messageRows.length > 0
  ) {
    return true
  }

  // Prefer sessionEntryId messaging: last entry present but sparse coverage.
  const lastId = lastSessionEntryId(input.items)
  if (lastId && messageRows.length >= 3) {
    const withIds = messageRows.filter((item) => !!item.sessionEntryId).length
    if (withIds / messageRows.length < 0.25) return true
  }

  return false
}
