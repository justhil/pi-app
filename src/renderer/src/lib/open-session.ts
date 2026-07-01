import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { loadSessionHistoryWithRetry, SessionHistoryNavStaleError } from '@renderer/lib/load-session-history'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { fetchWorkerLiveSnapshot, syncViewRunStateFromWorkerSnapshot } from '@renderer/lib/session-worker-sync'

/**
 * 切换会话：时间线 tail 预览 + pendingBind；Worker loadSession 在首条 prompt / steer / followUp 或 session.navigateTree。
 */
export async function openSessionIntoWorker(
  sessionId: string,
  sessionFile?: string,
  navToken?: number,
  opts?: { workerReady?: boolean },
): Promise<void> {
  const store = useUIStore.getState()

  if (!sessionFile) {
    store.setCurrentSession(sessionId)
    store.clearTimeline()
    store.clearFileChanges()
    useExtensionUIStore.getState().resetForSessionContext()
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    if (navToken != null && !assertSessionNavigation(navToken)) return
    await applyComposerDisplayMeta()
    void refreshSessionTree(null)
    return
  }

  // 不 session.prepare：避免切换时 resourceLoader + createAgentSession 全量绑定
  store.setCurrentSession(sessionId)
  store.clearTimeline()
  store.clearFileChanges()
  useExtensionUIStore.getState().resetForSessionContext()
  const snapEarly = await fetchWorkerLiveSnapshot().catch(() => null)
  if (snapEarly) store.setWorkerLiveSnapshot(snapEarly)
  const boundAndRunning =
    !!sessionFile && snapEarly?.sessionFile === sessionFile && snapEarly.status === 'running'
  if (!boundAndRunning) {
    store.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })
  } else {
    syncViewRunStateFromWorkerSnapshot(sessionFile, snapEarly, (p) => store.setRunState(p))
  }
  if (!store.historyLoading) {
    store.setHistoryLoading(true)
  }
  store.setHistoryMeta(0, 0, sessionFile)

  try {
    const hist = await loadSessionHistoryWithRetry(sessionFile, {
      navToken,
      bindPending: true,
      alignWorkerOnRetry: false,
      workerReady: opts?.workerReady,
    })
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
    if (e instanceof SessionHistoryNavStaleError) {
      store.setHistoryLoading(false)
      return
    }
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
      const snap = await fetchWorkerLiveSnapshot().catch(() => null)
      if (snap) {
        store.setWorkerLiveSnapshot(snap)
        syncViewRunStateFromWorkerSnapshot(store.historySessionFile, snap, (p) => store.setRunState(p))
      }
    }
  }
}

/** @deprecated 使用 afterPromptSent；保留别名避免旧引用 */
export async function onWorkerSessionBound(): Promise<void> {
  const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
  await afterPromptSent()
}