import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { beginSessionNavigation, assertSessionNavigation } from '@renderer/lib/session-navigation'
import { PENDING_NEW_SESSION_ID } from '@renderer/lib/session-ids'

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

  const openPromise = !sameProject
    ? ipcClient.invoke('workspace.open', { path }).catch((e) => {
        console.error('[activateWorkspace] workspace.open failed:', e)
      })
    : Promise.resolve()

  let sessions: Array<{ sessionId: string; sessionFile?: string; title?: string; updatedAt?: number }> = []
  try {
    await openPromise
    if (!assertSessionNavigation(navToken)) return
    const listRes = await ipcClient.invoke('session.list', { workspaceId: path })
    if (!assertSessionNavigation(navToken)) return
    sessions = listRes?.sessions || []
    store.setSessions(sessions)
  } catch (e) {
    console.error('[activateWorkspace] session.list failed:', e)
    if (!assertSessionNavigation(navToken)) return
  }

  if (options?.preferHome) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    store.setHistoryMeta(0, 0, null)
    void refreshComposerRunDisplay()
    return
  }

  if (sessions.length === 0) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    store.setHistoryMeta(0, 0, null)
    void refreshComposerRunDisplay()
    return
  }

  const pick =
    options?.sessionId && options.sessionFile
      ? { sessionId: options.sessionId, sessionFile: options.sessionFile }
      : sessions.find((s) => s.sessionId === options?.sessionId) ||
        sessions.find((s) => s.sessionFile === options?.sessionFile) ||
        sessions[0]

  if (!pick?.sessionFile) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(null)
    return
  }

  await openSessionIntoWorker(pick.sessionId, pick.sessionFile, navToken)
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

  await openSessionIntoWorker(sessionId, file, navToken)
}