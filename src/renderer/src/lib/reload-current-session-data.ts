import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { requestTimelineBottomAnchor } from '@renderer/features/timeline/timeline-bottom-anchor'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { captureFocusFromUiStore } from '@renderer/lib/session-shell'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

let reloadGeneration = 0

export async function reloadCurrentSessionData(): Promise<{ ok: boolean; error?: string }> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  const sessionId = store.currentSessionId
  const generation = ++reloadGeneration
  const stillCurrent = (): boolean =>
    generation === reloadGeneration &&
    sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)

  void refreshWorkspaceSessionLists()

  if (!sessionFile || !sessionId) {
    return { ok: true }
  }

  store.setHistoryLoading(true)
  try {
    const hist = await loadSessionHistoryWithRetry(sessionFile, { bindPending: false, alignWorkerOnRetry: false })
    if (!stillCurrent()) return { ok: true }
    if (hist.error) return { ok: false, error: hist.error }
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    const { items, totalCount, sessionMeta } = hist
    store.loadHistoryItems(sanitizeHistoryTimeline(items as TimelineItem[]))
    store.setHistoryMeta(totalCount, items.length, sessionFile)
    captureFocusFromUiStore()
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