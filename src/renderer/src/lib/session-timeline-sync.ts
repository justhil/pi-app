import { ipcClient } from '@renderer/lib/ipc-client'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  isTimelineCatchUpComplete,
  planTimelineTailFetch,
  TIMELINE_FETCH_PAGE_SIZE,
  type TimelineSyncCursor,
} from '@shared/session-timeline-sync-plan'
import { projectTimelineItems } from '@shared/timeline-projection'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'

export type HistoryPage = {
  items: TimelineItem[]
  sourceCount: number
  totalCount: number
  error?: string
}

export async function fetchTimelineHistoryPage(
  sessionFile: string,
  offset: number,
  limit: number = TIMELINE_FETCH_PAGE_SIZE,
): Promise<HistoryPage> {
  return fetchPage(sessionFile, offset, limit)
}

async function fetchPage(sessionFile: string, offset: number, limit: number): Promise<HistoryPage> {
  const workspaceId = useUIStore.getState().currentWorkspace || undefined
  const res = await ipcClient.invoke('session.getMessages', { sessionFile, workspaceId, offset, limit })
  const err = (res as { error?: string })?.error
  if (err) return { items: [], sourceCount: 0, totalCount: 0, error: err }
  const sourceItems = (res?.items || []) as TimelineItem[]
  const sourceCount =
    typeof (res as { sourceCount?: number })?.sourceCount === 'number'
      ? (res as { sourceCount: number }).sourceCount
      : sourceItems.length
  const items = sanitizeHistoryTimeline(sourceItems)
  const totalCount = typeof res?.totalCount === 'number' ? res.totalCount : sourceCount
  return {
    items: projectTimelineItems(items) as TimelineItem[],
    sourceCount,
    totalCount,
  }
}

export function lastSessionEntryId(items: TimelineItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const id = items[i].sessionEntryId
    if (id) return id
  }
  return null
}

export async function syncAuthoritativeTail(sessionFile: string, limit = TIMELINE_FETCH_PAGE_SIZE): Promise<{
  tail: TimelineItem[]
  cursor: TimelineSyncCursor
}> {
  const plan = planTimelineTailFetch(limit)
  const page = await fetchPage(sessionFile, 0, plan.limit)
  const tail = page.items
  const cursor: TimelineSyncCursor = {
    totalCount: page.totalCount,
    loadedOffsetFromEnd: Math.min(page.totalCount, page.sourceCount),
    loadedThroughEntryId: lastSessionEntryId(tail),
  }
  return { tail, cursor }
}

/** Prepend older JSONL pages until loadedOffsetFromEnd reaches totalCount. */
export async function catchUpAuthoritativeAfter(
  sessionFile: string,
  cursor: TimelineSyncCursor,
  limit = TIMELINE_FETCH_PAGE_SIZE,
  initialTail?: TimelineItem[],
): Promise<{ tail: TimelineItem[]; cursor: TimelineSyncCursor; error?: string }> {
  let totalCount = cursor.totalCount
  let loadedOffset = cursor.loadedOffsetFromEnd
  let tail: TimelineItem[] = initialTail ? [...initialTail] : []
  let error: string | undefined

  if (!initialTail) {
    const boot = await fetchPage(sessionFile, 0, Math.max(limit, loadedOffset || limit))
    if (boot.error) return { tail: [], cursor, error: boot.error }
    totalCount = boot.totalCount
    tail = boot.items
    loadedOffset = boot.sourceCount
  }

  for (let guard = 0; guard < 32; guard++) {
    if (isTimelineCatchUpComplete({ totalCount, loadedOffsetFromEnd: loadedOffset, error })) break
    const page = await fetchPage(sessionFile, loadedOffset, limit)
    if (page.error) {
      error = page.error
      break
    }
    totalCount = Math.max(totalCount, page.totalCount)
    if (page.sourceCount === 0) break
    tail = [...page.items, ...tail]
    loadedOffset += page.sourceCount
  }

  return {
    tail,
    cursor: {
      totalCount,
      loadedOffsetFromEnd: Math.min(totalCount, loadedOffset),
      loadedThroughEntryId: lastSessionEntryId(tail) ?? cursor.loadedThroughEntryId,
    },
    error,
  }
}

/** Tail page + older pages for open-session (totalCount > limit). */
export async function loadAuthoritativeForOpen(
  sessionFile: string,
  pageSize = TIMELINE_FETCH_PAGE_SIZE,
): Promise<{ items: TimelineItem[]; totalCount: number; cursor: TimelineSyncCursor; error?: string }> {
  const initial = await syncAuthoritativeTail(sessionFile, pageSize)
  if (isTimelineCatchUpComplete(initial.cursor)) {
    return { items: initial.tail, totalCount: initial.cursor.totalCount, cursor: initial.cursor }
  }
  const caught = await catchUpAuthoritativeAfter(
    sessionFile,
    initial.cursor,
    pageSize,
    initial.tail,
  )
  return {
    items: caught.tail,
    totalCount: caught.cursor.totalCount,
    cursor: caught.cursor,
    error: caught.error,
  }
}