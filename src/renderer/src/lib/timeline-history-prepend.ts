import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { projectTimelineItems } from '@shared/timeline-projection'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { fetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { getSessionTimelineView, patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { useUIStore } from '@renderer/stores/ui-store'
import { SESSION_HISTORY_PAGE } from '@renderer/lib/session-history'

/** Older JSONL page → SessionTimelineView.head + ui-store (offset = historyLoadedCount). */
export async function prependOlderTimelinePage(
  sessionFile: string,
  offset: number,
  limit = SESSION_HISTORY_PAGE,
): Promise<{ items: TimelineItem[]; totalCount: number; error?: string }> {
  const page = await fetchTimelineHistoryPage(sessionFile, offset, limit)
  if (page.error) return { items: [], totalCount: page.totalCount, error: page.error }
  if (page.items.length === 0) return { items: [], totalCount: page.totalCount }

  const store = useUIStore.getState()
  const view = getSessionTimelineView(sessionFile)
  const prevHead = view?.head ?? []
  patchSessionTimelineView(sessionFile, { head: [...page.items, ...prevHead] })

  const merged = sanitizeHistoryTimeline([...page.items, ...store.timelineItems])
  const displayed = projectTimelineItems(merged) as TimelineItem[]
  useUIStore.setState({
    timelineItems: displayed,
    historyLoadedCount: store.historyLoadedCount + page.items.length,
    historyTotalCount: Math.max(store.historyTotalCount, page.totalCount),
  })

  return { items: page.items, totalCount: page.totalCount }
}