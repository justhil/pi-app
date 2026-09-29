import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { projectTimelineItems } from '@shared/timeline-projection'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { fetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { useUIStore } from '@renderer/stores/ui-store'
import { SESSION_HISTORY_PAGE } from '@renderer/lib/session-history'

/** Older JSONL page → ui-store (offset = historyLoadedCount). */
export async function prependOlderTimelinePage(
  sessionFile: string,
  offset: number,
  limit = SESSION_HISTORY_PAGE,
): Promise<{ items: TimelineItem[]; sourceCount: number; totalCount: number; error?: string }> {
  const page = await fetchTimelineHistoryPage(sessionFile, offset, limit)
  if (page.error) {
    return {
      items: [],
      sourceCount: 0,
      totalCount: page.totalCount,
      error: page.error,
    }
  }

  const store = useUIStore.getState()
  if (page.items.length > 0) {
    const merged = sanitizeHistoryTimeline([...page.items, ...store.timelineItems])
    const displayed = projectTimelineItems(merged) as TimelineItem[]
    useUIStore.setState({ timelineItems: displayed })
  }

  useUIStore.setState({
    historyLoadedCount: Math.min(
      Math.max(store.historyTotalCount, page.totalCount),
      store.historyLoadedCount + page.sourceCount,
    ),
    historyTotalCount: Math.max(store.historyTotalCount, page.totalCount),
  })

  return {
    items: page.items,
    sourceCount: page.sourceCount,
    totalCount: page.totalCount,
  }
}