import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { fetchSessionHistoryTail, clearSessionHistoryCache } from '@renderer/lib/session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'

/**
 * 切换会话：只拉 Timeline 尾部 + pendingBind；Worker 在首条 prompt.send 时再 loadSession（快切会话）。
 */
export async function openSessionIntoWorker(sessionId: string, sessionFile?: string): Promise<void> {
  const store = useUIStore.getState()
  store.setCurrentSession(sessionId)
  store.clearTimeline()
  store.clearFileChanges()
  useExtensionUIStore.getState().resetForSessionContext()
  store.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })

  if (!sessionFile) {
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    await applyComposerDisplayMeta()
    void refreshSessionTree(null)
    return
  }

  store.setHistoryLoading(true)
  try {
    const [, hist] = await Promise.all([
      ipcClient.invoke('session.setPendingBind', { sessionFile }),
      fetchSessionHistoryTail(sessionFile),
    ])
    const { items, totalCount, sessionMeta } = hist
    store.loadHistoryItems(items as any[])
    store.setHistoryMeta(totalCount, items.length, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    void refreshSessionTree(sessionFile)
  } catch (e) {
    console.error('[openSession] failed:', e)
    store.loadHistoryItems([])
    store.setHistoryMeta(0, 0, sessionFile)
    await applyComposerDisplayMeta()
    void refreshSessionTree(sessionFile)
  } finally {
    store.setHistoryLoading(false)
  }
}

/** 首条 prompt 绑定 Worker 后刷新运行态；会话树在 Worker 就绪后再拉一次 */
export async function onWorkerSessionBound(): Promise<void> {
  clearSessionHistoryCache()
  await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  const { syncRunStateFromWorker } = await import('@renderer/lib/sync-run-state')
  await syncRunStateFromWorker()
  const st = useUIStore.getState()
  const file = st.historySessionFile
  if (file) {
    try {
      const hist = await fetchSessionHistoryTail(file)
      st.loadHistoryItems(hist.items as any[])
      st.setHistoryMeta(hist.totalCount, hist.items.length, file)
    } catch (e) {
      console.error('[onWorkerSessionBound] history refresh', e)
    }
    void refreshSessionTree(file)
  }
}