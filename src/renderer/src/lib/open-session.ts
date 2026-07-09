import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { focusSession, focusSessionSync, hydrateSessionView } from '@renderer/lib/session-shell'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

/**
 * Open / switch conversation session.
 *
 * Fast path (Session Shell):
 * 1. capture current view into cache
 * 2. focus target — bind cache immediately (no full skeleton when cached)
 * 3. hydrate disk tail in background (cancellable via navToken)
 *
 * Worker bind remains lazy (F1): first prompt/steer/followUp creates the process.
 */
export async function openSessionIntoWorker(
  sessionId: string,
  sessionFile?: string,
  navToken?: number,
  _opts?: { workerReady?: boolean },
): Promise<void> {
  captureVisibleLiveSessionTimeline()
  const store = useUIStore.getState()

  if (!sessionFile) {
    store.setCurrentSession(sessionId)
    store.clearTimeline()
    store.clearFileChanges()
    useExtensionUIStore.getState().resetForSessionContext()
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    store.setHistoryLoading(false)
    store.setRunState({
      status: 'idle',
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: undefined,
    })
    store.setWorkerLiveSnapshot({ sessionId: null, sessionFile: null, status: 'idle' })
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
    if (navToken != null && !assertSessionNavigation(navToken)) return
    await applyComposerDisplayMeta()
    void refreshSessionTree(null)
    return
  }

  useExtensionUIStore.getState().resetForSessionContext()

  // Instant focus: cache hit skips full-screen loading skeleton
  const { sessionKey, instant } = focusSessionSync(sessionId, sessionFile)
  if (navToken != null && !assertSessionNavigation(navToken)) return

  // Pending bind is cheap — do not wait on hydrate for interactivity.
  void ipcClient.invoke('session.setPendingBind', { sessionFile: sessionKey }).catch(() => {})
  // Session tree is non-critical chrome; never block timeline paint.
  void refreshSessionTree(sessionFile)

  if (instant) {
    // Cache hit: paint immediately; revalidate disk in background (no skeleton).
    void hydrateSessionView(sessionKey, sessionId, navToken).then(() => {
      if (navToken != null && !assertSessionNavigation(navToken)) return
      const latest = useUIStore.getState()
      if (!sessionFilesEqual(latest.historySessionFile, sessionFile)) return
      if (latest.historyLoading) latest.setHistoryLoading(false)
    })
    return
  }

  // Cold open: await disk tail once (disk-only IPC, no worker spawn).
  await hydrateSessionView(sessionKey, sessionId, navToken)
  if (navToken != null && !assertSessionNavigation(navToken)) return

  const latest = useUIStore.getState()
  if (!sessionFilesEqual(latest.historySessionFile, sessionFile)) return
  if (latest.historyLoading) latest.setHistoryLoading(false)
}

/** Same as focusSession for callers that only need shell semantics */
export async function openSessionViaShell(
  sessionId: string,
  sessionFile: string,
  navToken?: number,
): Promise<{ instant: boolean }> {
  captureVisibleLiveSessionTimeline()
  useExtensionUIStore.getState().resetForSessionContext()
  return focusSession(sessionId, sessionFile, navToken)
}

/** @deprecated 使用 afterPromptSent；保留别名避免旧引用 */
export async function onWorkerSessionBound(): Promise<void> {
  const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
  await afterPromptSent()
}
