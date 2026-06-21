import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { openSessionIntoWorker } from '@renderer/lib/open-session'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'

export type ActivateWorkspaceOptions = {
  preferEmpty?: boolean
  sessionId?: string
  sessionFile?: string
}

/**
 * 切换工作区：先更新 UI，workspace.open / Worker 在后台跑，避免卡在 sqlite 或 Worker 重启。
 */
export async function activateWorkspace(path: string, options?: ActivateWorkspaceOptions): Promise<void> {
  const store = useUIStore.getState()
  if (store.ephemeralSandboxDraft) store.clearEphemeralSandboxDraft()

  const sameProject = store.currentWorkspace === path

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
    const listRes = await ipcClient.invoke('session.list', { workspaceId: path })
    sessions = listRes?.sessions || []
    store.setSessions(sessions)
  } catch (e) {
    console.error('[activateWorkspace] session.list failed:', e)
  }

  if (options?.preferEmpty || sessions.length === 0) {
    store.setCurrentSession(null)
    store.setHistoryMeta(0, 0, null)
    store.loadHistoryItems([])
    void ipcClient.invoke('session.setPendingBind', { sessionFile: null })
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
    store.setCurrentSession(null)
    store.loadHistoryItems([])
    store.setHistoryMeta(0, 0, null)
    return
  }

  await openSessionIntoWorker(pick.sessionId, pick.sessionFile)
}

/** 同项目内切会话：不重启 Worker cwd，只换历史 + pending bind */
export async function switchSessionInPlace(sessionId: string, sessionFile?: string): Promise<void> {
  await openSessionIntoWorker(sessionId, sessionFile)
}