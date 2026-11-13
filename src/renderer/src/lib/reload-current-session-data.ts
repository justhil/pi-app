import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { requestTimelineBottomAnchor } from '@renderer/features/timeline/timeline-bottom-anchor'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import type { TimelineItem } from '@renderer/stores/ui-store-types'
import { sanitizeHistoryTimeline } from '@renderer/lib/timeline-dedupe'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { bumpSessionHydrateEpoch } from '@renderer/lib/session-shell'
import { flushAllStreamPendingSync } from '@renderer/stores/ui-store-stream'

let reloadGeneration = 0

/** Fired by the reload button so the sidebar refreshes projects, worktrees and session lists too. */
export const SIDEBAR_RELOAD_EVENT = 'pi-desktop:reload-sidebar'

export async function reloadCurrentSessionData(): Promise<{ ok: boolean; error?: string }> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  const sessionId = store.currentSessionId
  const generation = ++reloadGeneration
  const navToken = getSessionNavigationToken()
  const stillCurrent = (): boolean =>
    generation === reloadGeneration &&
    isSessionNavigationCurrent(navToken) &&
    sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)

  void refreshWorkspaceSessionLists()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SIDEBAR_RELOAD_EVENT))

  if (!sessionFile || !sessionId) {
    return { ok: true }
  }

  store.setHistoryLoading(true)
  try {
    const hist = await loadSessionHistoryWithRetry(sessionFile, { bindPending: false, alignWorkerOnRetry: false })
    if (!stillCurrent()) return { ok: true }
    if (hist.error) return { ok: false, error: hist.error }
    flushAllStreamPendingSync()
    const before = useUIStore.getState()
    const prevLoaded = before.historyLoadedCount
    const prevTotal = before.historyTotalCount
    const { items, sourceCount, totalCount, sessionMeta } = hist
    const sanitized = sanitizeHistoryTimeline(items as TimelineItem[])
    before.loadHistoryItems(sanitized)
    const afterItems = useUIStore.getState().timelineItems
    const diskCount = Math.min(totalCount, sourceCount ?? items.length)
    const firstDiskEntry = sanitized.find((row) => !!row.sessionEntryId)?.sessionEntryId
    const diskAnchorIdx = firstDiskEntry
      ? afterItems.findIndex((row) => row.sessionEntryId === firstDiskEntry)
      : -1
    const keptOlderPrefix = diskAnchorIdx > 0
    const nextLoaded = keptOlderPrefix
      ? Math.min(totalCount, Math.max(diskCount, prevLoaded + Math.max(0, totalCount - prevTotal)))
      : diskCount
    useUIStore.getState().setHistoryMeta(totalCount, nextLoaded, sessionFile)
    bumpSessionHydrateEpoch(sessionFile)
    captureVisibleLiveSessionTimeline()
    await applyComposerDisplayMeta(sessionMeta)
    if (!stillCurrent()) return { ok: true }
    void refreshSessionTree(sessionFile)
    // 重载确认的是磁盘最新内容：把视口钉回最新（用户可能在检查历史位置时触发重载）
    requestTimelineBottomAnchor('session-reloaded')
    return { ok: true }
  } catch (e: unknown) {
    console.error('[reloadCurrentSessionData]', e)
    return { ok: false, error: (e instanceof Error ? e.message : String(e)) || '刷新失败' }
  } finally {
    if (stillCurrent()) useUIStore.getState().setHistoryLoading(false)
  }
}