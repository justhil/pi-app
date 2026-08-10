import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { applyComposerDisplayMeta } from '@renderer/lib/session-display-meta'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { assertSessionNavigation } from '@renderer/lib/session-navigation'
import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import {
  focusSession,
  focusSessionSync,
  getFocusSessionKey,
  getSessionView,
  hydrateSessionView,
} from '@renderer/lib/session-shell'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

async function openExistingSessionView(
  sessionId: string,
  sessionFile: string,
  navToken: number | undefined,
  bindWorker: boolean,
): Promise<void> {
  captureVisibleLiveSessionTimeline()
  useExtensionUIStore.getState().resetForSessionContext()

  // switchSessionInPlace / activateWorkspace / previewSessionInPlace 已在同一同步流程里
  // capture + focus 过本会话；这里跳过冗余的再次 capture + 重绑定，减少每次切换的合并开销。
  const alreadyFocused = sessionFilesEqual(getFocusSessionKey(), sessionFile)
  let sessionKey: string
  let instant: boolean
  if (alreadyFocused) {
    sessionKey = getFocusSessionKey()!
    instant = (getSessionView(sessionKey)?.items.length ?? 0) > 0
  } else {
    ;({ sessionKey, instant } = focusSessionSync(sessionId, sessionFile))
  }
  if (navToken != null && !assertSessionNavigation(navToken)) return

  if (bindWorker) {
    void ipcClient.invoke('session.setPendingBind', { sessionFile: sessionKey }).catch(() => {})
  }
  void refreshSessionTree(sessionFile)

  if (instant) {
    void hydrateSessionView(sessionKey, sessionId, navToken, { bindWorker }).then(() => {
      if (navToken != null && !assertSessionNavigation(navToken)) return
      const latest = useUIStore.getState()
      if (!sessionFilesEqual(latest.historySessionFile, sessionFile)) return
      if (latest.historyLoading) latest.setHistoryLoading(false)
    })
    return
  }

  await hydrateSessionView(sessionKey, sessionId, navToken, { bindWorker })
  if (navToken != null && !assertSessionNavigation(navToken)) return

  const latest = useUIStore.getState()
  if (!sessionFilesEqual(latest.historySessionFile, sessionFile)) return
  if (latest.historyLoading) latest.setHistoryLoading(false)
}

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
  const store = useUIStore.getState()

  if (!sessionFile) {
    captureVisibleLiveSessionTimeline()
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

  await openExistingSessionView(sessionId, sessionFile, navToken, true)
}

/** Open a child session as disk-backed history without binding it for prompts. */
export async function openSessionPreview(
  sessionId: string,
  sessionFile: string,
  navToken?: number,
): Promise<void> {
  await openExistingSessionView(sessionId, sessionFile, navToken, false)
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
