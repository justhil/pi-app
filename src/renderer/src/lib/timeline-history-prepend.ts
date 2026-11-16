import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { projectTimelineItems } from '@shared/timeline-projection'
import { mergePrependedHistoryItems } from '@renderer/lib/timeline-dedupe'
import { fetchTimelineHistoryPage } from '@renderer/lib/session-timeline-sync'
import { useUIStore } from '@renderer/stores/ui-store'
import { SESSION_HISTORY_PAGE } from '@renderer/lib/session-history'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import {
  getSessionHydrateEpoch,
  isSessionHydrating,
  waitForSessionHydrate,
} from '@renderer/lib/session-shell'

/** Older JSONL page → ui-store (offset = historyLoadedCount). */
export async function prependOlderTimelinePage(
  sessionFile: string,
  offset: number,
  limit = SESSION_HISTORY_PAGE,
): Promise<{ items: TimelineItem[]; sourceCount: number; totalCount: number; error?: string; cancelled?: boolean }> {
  const navToken = getSessionNavigationToken()
  let effectiveOffset = offset
  if (isSessionHydrating(sessionFile)) {
    await waitForSessionHydrate(sessionFile)
    const afterHydrate = useUIStore.getState()
    if (!isSessionNavigationCurrent(navToken) || !sessionFilesEqual(afterHydrate.historySessionFile, sessionFile)) {
      return { items: [], sourceCount: 0, totalCount: afterHydrate.historyTotalCount, cancelled: true }
    }
    if (afterHydrate.historyLoadedCount >= afterHydrate.historyTotalCount) {
      return { items: [], sourceCount: 0, totalCount: afterHydrate.historyTotalCount }
    }
    effectiveOffset = afterHydrate.historyLoadedCount
  }

  const hydrateEpoch = getSessionHydrateEpoch(sessionFile)
  const page = await fetchTimelineHistoryPage(sessionFile, effectiveOffset, limit)
  const store = useUIStore.getState()
  if (
    !isSessionNavigationCurrent(navToken) ||
    !sessionFilesEqual(store.historySessionFile, sessionFile) ||
    getSessionHydrateEpoch(sessionFile) !== hydrateEpoch
  ) {
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
  let addedSource = page.sourceCount
  if (page.items.length > 0) {
    const merged = mergePrependedHistoryItems(page.items, store.timelineItems)
    timelineItems = projectTimelineItems(merged.items) as TimelineItem[]
    // If every row in the page already existed in the store, advance loaded count
    // at most by what wasn't already covered (avoid inflating offset on overlap).
    if (merged.addedCount === 0) {
      addedSource = 0
    } else if (merged.addedCount < page.items.length) {
      addedSource = Math.max(merged.addedCount, page.sourceCount - (page.items.length - merged.addedCount))
    }
  }

  const nextTotal = Math.max(store.historyTotalCount, page.totalCount)
  useUIStore.setState({
    timelineItems,
    historyLoadedCount: Math.min(nextTotal, store.historyLoadedCount + addedSource),
    historyTotalCount: nextTotal,
  })

  return {
    items: page.items,
    sourceCount: page.sourceCount,
    totalCount: page.totalCount,
  }
}
