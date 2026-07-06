export const TIMELINE_FETCH_PAGE_SIZE = 80

export type TimelineSyncCursor = {
  loadedOffsetFromEnd: number
  totalCount: number
  loadedThroughEntryId?: string | null
}

export type TimelineFetchDirection = 'tail' | 'before' | 'after'

export type TimelineFetchPlan =
  | { direction: 'tail'; limit: number }
  | { direction: 'before'; offset: number; limit: number }
  | { direction: 'after'; offset: number; limit: number }

export function planTimelineTailFetch(limit = TIMELINE_FETCH_PAGE_SIZE): TimelineFetchPlan {
  return { direction: 'tail', limit }
}

export function planTimelineOlderFetch(offset: number, limit = TIMELINE_FETCH_PAGE_SIZE): TimelineFetchPlan {
  return { direction: 'before', offset, limit }
}

export function planTimelineCatchUpAfter(offset: number, limit = TIMELINE_FETCH_PAGE_SIZE): TimelineFetchPlan {
  return { direction: 'after', offset, limit }
}

export function planResumeTimelineSync(cursor: TimelineSyncCursor | undefined): TimelineFetchPlan {
  if (cursor && cursor.loadedOffsetFromEnd > 0 && cursor.loadedOffsetFromEnd < cursor.totalCount) {
    return planTimelineCatchUpAfter(cursor.loadedOffsetFromEnd)
  }
  return planTimelineTailFetch()
}

export function isTimelineCatchUpComplete(input: {
  totalCount: number
  loadedOffsetFromEnd: number
  error?: string | null
}): boolean {
  if (input.error) return false
  if (input.totalCount <= 0) return true
  return input.loadedOffsetFromEnd >= input.totalCount
}

export function detectTimelineGap(input: {
  authoritativeLastEntryId?: string | null
  liveFirstEntryId?: string | null
}): boolean {
  const a = input.authoritativeLastEntryId
  const b = input.liveFirstEntryId
  if (!a || !b) return false
  return a !== b
}

export function nextLoadedOffsetAfterPage(input: {
  previousLoadedOffsetFromEnd: number
  pageItemCount: number
  totalCount: number
}): number {
  const added = Math.max(0, input.pageItemCount)
  return Math.min(input.totalCount, input.previousLoadedOffsetFromEnd + added)
}