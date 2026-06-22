import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { fetchSessionHistoryTail, clearSessionHistoryCache } from '@renderer/lib/session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'

/**
 * 切换会话：Timeline + pendingBind；真实 session 绑定在首条 prompt 或 session.prepare。
 */
export async function openSessionIntoWorker(
  sessionId: string,
  sessionFile?: string,
  navToken?: number,
): Promise<void> {
  const store = useUIStore.getState()
  // Lazy worker start: home mode may not have started the Worker yet. Clicking a
  // history session needs the Worker for getMessages + later loadSession.
  if (sessionFile) {
    const ws = useUIStore.getState().currentWorkspace
    if (ws) {
      await ipcClient.invoke('workspace.switch', { workspaceId: ws }).catch(() => {})
      if (navToken != null && !assertSessionNavigation(navToken)) return
    }
  }
  store.setCurrentSession(sessionId)
  store.clearTimeline()
  store.clearFileChanges()
  useExtensionUIStore.getState().resetForSessionContext()
  store.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })

  if (!sessionFile) {
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    if (navToken != null && !assertSessionNavigation(navToken)) return
    await applyComposerDisplayMeta()
    void refreshSessionTree(null)
    return
  }

  store.setHistoryLoading(true)
  clearSessionHistoryCache(sessionFile)
  try {
    const [, hist] = await Promise.all([
      ipcClient.invoke('session.setPendingBind', { sessionFile }),
      fetchSessionHistoryTail(sessionFile, undefined, { bypassCache: true }),
    ])
    if (navToken != null && !assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
      return
    }
    const { items, totalCount, sessionMeta } = hist
    const { sanitizeHistoryTimeline } = await import('@renderer/lib/timeline-dedupe')
    store.loadHistoryItems(sanitizeHistoryTimeline(items as any[]))
    store.setHistoryMeta(totalCount, items.length, sessionFile)
    await applyComposerDisplayMeta(sessionMeta)
    void refreshSessionTree(sessionFile)
  } catch (e) {
    console.error('[openSession] failed:', e)
    if (navToken != null && !assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
      return
    }
    store.loadHistoryItems([])
    store.setHistoryMeta(0, 0, sessionFile)
    await applyComposerDisplayMeta()
    void refreshSessionTree(sessionFile)
  } finally {
    if (navToken == null || assertSessionNavigation(navToken)) {
      store.setHistoryLoading(false)
    }
  }
}

/** @deprecated 使用 afterPromptSent；保留别名避免旧引用 */
export async function onWorkerSessionBound(): Promise<void> {
  const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
  await afterPromptSent()
}