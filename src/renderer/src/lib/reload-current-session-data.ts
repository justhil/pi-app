import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

export async function reloadCurrentSessionData(): Promise<{ ok: boolean; error?: string }> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  const sessionId = store.currentSessionId

  // 先消除徽标：接下来是完整重载（视图将包含磁盘全部内容）；
  // 若中途失败也不残留“外部更新”状态（CLI 若继续写入会自动重新亮起）
  useUIStore.getState().setExternalUpdateFor(null)

  await refreshWorkspaceSessionLists().catch(() => {})

  if (!sessionFile || !sessionId) {
    return { ok: true }
  }

  store.setHistoryLoading(true)
  try {
    const reloadRes = await ipcClient.invoke('session.reloadFromDisk', { sessionFile }).catch(() => ({ ok: false }))
    if (!reloadRes?.ok) {
      console.warn('[reloadCurrentSessionData] Worker reload:', reloadRes?.error)
    }
    const hist = await loadSessionHistoryWithRetry(sessionFile, { bindPending: false, alignWorkerOnRetry: false })
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    const { items, totalCount, sessionMeta } = hist
    store.loadHistoryItems(sanitizeHistoryTimeline(items as TimelineItem[]))
    store.setHistoryMeta(totalCount, items.length, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    void refreshSessionTree(sessionFile)
    // 完整重载已把磁盘内容并入视图：外部更新状态视为已确认，徽标消除（CLI 若继续写入会自动再亮）
    useUIStore.getState().setExternalUpdateFor(null)
    return { ok: true }
  } catch (e: unknown) {
    console.error('[reloadCurrentSessionData]', e)
    return { ok: false, error: (e instanceof Error ? e.message : String(e)) || '刷新失败' }
  } finally {
    store.setHistoryLoading(false)
  }
}
