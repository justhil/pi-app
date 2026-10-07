import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { projectTimelineItems } from '@shared/timeline-projection'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { fetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { useUIStore } from '@renderer/stores/ui-store'
import { SESSION_HISTORY_PAGE } from '@renderer/lib/session-history'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'

/** Older JSONL page → ui-store (offset = historyLoadedCount). */
export async function prependOlderTimelinePage(
  sessionFile: string,
  offset: number,
  limit = SESSION_HISTORY_PAGE,
): Promise<{ items: TimelineItem[]; sourceCount: number; totalCount: number; error?: string; cancelled?: boolean }> {
  const navToken = getSessionNavigationToken()
  const page = await fetchTimelineHistoryPage(sessionFile, offset, limit)
  const store = useUIStore.getState()
  if (!isSessionNavigationCurrent(navToken) || !sessionFilesEqual(store.historySessionFile, sessionFile)) {
    return { ...page, cancelled: true }
  }
  if (page.error) {
    return {
      items: [],
      sourceCount: 0,
      totalCount: page.totalCount,
      error: page.error,
    }
  }

  let timelineItems = store.timelineItems
  if (page.items.length > 0) {
    const merged = sanitizeHistoryTimeline([...page.items, ...store.timelineItems])
    timelineItems = projectTimelineItems(merged) as TimelineItem[]
  }

  useUIStore.setState({
    timelineItems,
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
