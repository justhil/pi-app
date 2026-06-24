import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { beginSessionNavigation, assertSessionNavigation } from '@renderer/lib/session-navigation'
import { PENDING_NEW_SESSION_ID } from '@renderer/lib/session-ids'
import { chooseWorkspaceSession, type WorkspaceSessionChoice } from '@renderer/lib/workspace-session-choice'

export type ActivateWorkspaceOptions = {
  preferHome?: boolean
  sessionId?: string
  sessionFile?: string
}

/**
 * 切换工作区：先更新 UI，workspace.open 在后台；快切用 navToken 丢弃过期结果。
 */
export async function activateWorkspace(path: string, options?: ActivateWorkspaceOptions): Promise<void> {
  const navToken = beginSessionNavigation()
  const store = useUIStore.getState()
  if (store.ephemeralSandboxDraft) store.clearEphemeralSandboxDraft()

  const sameProject = store.currentWorkspace === path
  if (!sameProject) {
    console.log('[activateWorkspace] workspace change', store.currentWorkspace, '->', path)
  }

  store.setWorkspace(path)
  store.clearTimeline()
  store.clearFileChanges()
  useExtensionUIStore.getState().resetForSessionContext()

  const openingSession = !!(options?.sessionId && options?.sessionFile)
  if (openingSession) {
    store.setCurrentSession(options!.sessionId!)
    store.setHistoryLoading(true)
    store.setHistoryMeta(0, 0, options!.sessionFile!)
  }

  const refreshSessionList = () => {
    void ipcClient
      .invoke('session.list', { workspaceId: path })
      .then((listRes) => {
        if (!assertSessionNavigation(navToken)) return
        const rows = listRes?.sessions || []
        store.setSessions(
          rows.map((s: WorkspaceSessionChoice & { messageCount?: number; modelId?: string }) => ({
            sessionId: s.sessionId,
            sessionFile: s.sessionFile,
            title: s.title ?? s.sessionId.slice(0, 8),
            updatedAt: s.updatedAt ?? 0,
            messageCount: s.messageCount,
            modelId: s.modelId ?? '',
          })),
        )
      })
      .catch((e) => console.error('[activateWorkspace] session.list failed:', e))
  }

  const openPromise = !sameProject
    ? ipcClient.invoke('workspace.open', { path, awaitWorker: true }).catch((e) => {
        console.error('[activateWorkspace] workspace.open failed:', e)
      })
    : ipcClient.invoke('workspace.ensureWorker', { path }).catch((e) => {
        console.error('[activateWorkspace] workspace.ensureWorker failed:', e)
      })

  if (options?.preferHome) {
    try {
      await openPromise
      if (!assertSessionNavigation(navToken)) return
      refreshSessionList()
    } catch {
      /* logged above */
    }
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    store.setHistoryMeta(0, 0, null)
    store.setHistoryLoading(false)
    void refreshComposerRunDisplay()
    return
  }

  const explicitPick =
    options?.sessionId && options?.sessionFile
      ? { sessionId: options.sessionId, sessionFile: options.sessionFile }
      : null

  if (explicitPick) {
    try {
      await openPromise
      if (!assertSessionNavigation(navToken)) return
    } catch {
      if (!assertSessionNavigation(navToken)) return
    }
    refreshSessionList()
    await openSessionIntoWorker(explicitPick.sessionId, explicitPick.sessionFile, navToken, {
      workerReady: true,
    })
    return
  }

  let sessions: WorkspaceSessionChoice[] = []
  try {
    await openPromise
    if (!assertSessionNavigation(navToken)) return
    const listRes = await ipcClient.invoke('session.list', { workspaceId: path })
    if (!assertSessionNavigation(navToken)) return
    sessions = listRes?.sessions || []
    store.setSessions(
      sessions.map((s) => ({
        sessionId: s.sessionId,
        sessionFile: s.sessionFile,
        title: s.title ?? s.sessionId.slice(0, 8),
        updatedAt: s.updatedAt ?? 0,
        messageCount: (s as { messageCount?: number }).messageCount,
        modelId: (s as { modelId?: string }).modelId ?? '',
      })),
    )
  } catch (e) {
    console.error('[activateWorkspace] session.list failed:', e)
    if (!assertSessionNavigation(navToken)) return
  }

  const pick = chooseWorkspaceSession(sessions, options)

  if (!pick) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    store.setHistoryMeta(0, 0, null)
    store.setHistoryLoading(false)
    void refreshComposerRunDisplay()
    return
  }

  if (!pick.sessionFile) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    store.setHistoryLoading(false)
    return
  }

  await openSessionIntoWorker(pick.sessionId, pick.sessionFile, navToken, {
    workerReady: sameProject,
  })
}

/** 同项目内切会话 */
export async function switchSessionInPlace(sessionId: string, sessionFile?: string): Promise<void> {
  const navToken = beginSessionNavigation()
  const store = useUIStore.getState()
  store.clearPendingNewSessionPlaceholder()

  if (sessionId === PENDING_NEW_SESSION_ID) {
    store.enterPendingNewSessionPlaceholder()
    return
  }

  let file = sessionFile
  if (!file) {
    file = store.sessions.find((s) => s.sessionId === sessionId)?.sessionFile
  }
  if (!file) {
    console.warn('[switchSessionInPlace] missing sessionFile for', sessionId)
    return
  }

  store.setCurrentSession(sessionId)
  store.setHistoryLoading(true)

  await openSessionIntoWorker(sessionId, file, navToken, { workerReady: true })
}