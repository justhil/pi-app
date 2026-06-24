import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { clearSessionHistoryCache, fetchSessionHistoryTail } from '@renderer/lib/session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { refreshWorkspaceSessionLists } from '@renderer/lib/refresh-workspace-session-lists'

export async function reloadCurrentSessionData(): Promise<{ ok: boolean; error?: string }> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  const sessionId = store.currentSessionId

  await refreshWorkspaceSessionLists()

  if (!sessionFile || !sessionId) {
    return { ok: true }
  }

  store.setHistoryLoading(true)
  clearSessionHistoryCache(sessionFile)
  try {
    const [reloadRes, hist] = await Promise.all([
      ipcClient.invoke('session.reloadFromDisk', { sessionFile }),
      fetchSessionHistoryTail(sessionFile, undefined, { bypassCache: true }),
    ])
    if (!reloadRes?.ok) {
      return { ok: false, error: reloadRes?.error || 'Worker 同步失败' }
    }
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    const { items, totalCount, sessionMeta } = hist
    store.loadHistoryItems(sanitizeHistoryTimeline(items as any[]))
    store.setHistoryMeta(totalCount, items.length, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    void refreshSessionTree(sessionFile)
    return { ok: true }
  } catch (e: any) {
    console.error('[reloadCurrentSessionData]', e)
    return { ok: false, error: e?.message || '刷新失败' }
  } finally {
    store.setHistoryLoading(false)
  }
}