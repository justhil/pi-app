import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { titleFromFirstMessage } from '@renderer/lib/ephemeral-sandbox'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { workspacePathsEqual } from '@shared/workspace-path'
import { getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

/** 侧栏「新会话」：仅占位，不碰 Worker */
export function enterNewSessionPlaceholder(): void {
  enterBlankSession('pending-project')
}

/** 首条消息：创建真实 session，立即回调 sessionFile，配置完成后返回发送目标。 */
export async function materializePendingNewSession(
  workspaceId: string,
  firstMessage: string,
  onSessionCreated?: (sessionFile: string) => void,
  origin = { state: useUIStore.getState(), navigationToken: getSessionNavigationToken() },
): Promise<string> {
  if (!workspaceId) throw new Error('A workspace is required to create a session')
  const store = origin.state

  const title = titleFromFirstMessage(firstMessage, 48) || '新会话'

  const res = await ipcClient.invoke('session.new', { workspaceId })
  const sessionId = res?.session?.sessionId
  if (!sessionId) throw new Error('session.new returned no sessionId')

  const sessionFile = res?.session?.sessionFile as string | undefined
  if (!sessionFile) throw new Error('session.new returned no sessionFile')

  const current = useUIStore.getState()
  const ownsView = isSessionNavigationCurrent(origin.navigationToken) &&
    current.currentWorkspace === store.currentWorkspace &&
    current.currentSessionId === store.currentSessionId &&
    current.historySessionFile === store.historySessionFile
  if (ownsView) {
    store.clearPendingNewSessionPlaceholder()
    store.setCurrentSession(sessionId)
    // Keep the optimistic first turn only in the view that submitted it.
    store.clearFileChanges()
    store.setHistoryMeta(0, 0, sessionFile)
  }
  insertSessionRowOptimistically(workspaceId, { sessionId, sessionFile, title })
  // The caller still needs the file when creation finishes in the background.
  onSessionCreated?.(sessionFile)
  if (ownsView) {
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }

  // Apply the user's pre-selected model/thinking level to the new session. Sequential on purpose:
  // the thinking level is clamped against the model's supported levels, so it must follow a
  // confirmed model switch (and is skipped when the switch is rejected).
  const { runState } = store
  if (sessionFile) {
    if (runState.model && runState.model.includes('/')) {
      const [provider, ...modelIdParts] = runState.model.split('/')
      const modelId = modelIdParts.join('/')
      const modelResult = await ipcClient.invoke('model.set', {
        sessionId: '',
        sessionFile,
        provider,
        modelId,
      })
      const requestedModel = `${provider}/${modelId}`
      if (modelResult.modelId !== requestedModel) {
        throw new Error(`Model selection was not confirmed: ${modelResult.modelId || 'unknown'}`)
      }
    }
    if (runState.thinkingLevel) {
      await ipcClient.invoke('thinkingLevel.set', {
        sessionId: '',
        sessionFile,
        level: runState.thinkingLevel,
      })
    }
  }

  if (isSessionNavigationCurrent(origin.navigationToken) &&
      sessionFilesEqual(useUIStore.getState().historySessionFile, sessionFile)) {
    const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
    void refreshComposerRunDisplay()
  }

  // The sidebar list only needs to show the new row; never hold the first prompt for it.
  void refreshNewSessionInList(workspaceId, { sessionId, sessionFile, title })
  return sessionFile
}

function insertSessionRowOptimistically(
  workspaceId: string,
  created: { sessionId: string; sessionFile?: string; title: string },
): void {
  const store = useUIStore.getState()
  if (store.sessionsWorkspace && !workspacePathsEqual(store.sessionsWorkspace, workspaceId)) return
  const current = store.sessions ?? []
  if (current.some((s) => s.sessionId === created.sessionId)) return
  const row = {
    sessionId: created.sessionId,
    sessionFile: created.sessionFile,
    title: created.title,
    updatedAt: Date.now(),
    messageCount: 0,
    modelId: '',
  }
  store.setSessions([row as SessionItem, ...current], workspaceId)
}

async function refreshNewSessionInList(
  workspaceId: string,
  created: { sessionId: string; sessionFile?: string; title: string },
): Promise<void> {
  const store = useUIStore.getState()
  const { sessionId, sessionFile, title } = created
  const listRes = await ipcClient.invoke('session.list', { workspaceId }).catch(() => null)
  let sessions = (listRes?.sessions || []) as Array<{
    sessionId: string
    sessionFile?: string
    title?: string
    updatedAt?: number
  }>
  const row = {
    sessionId,
    sessionFile,
    title,
    updatedAt: Date.now(),
    messageCount: 0,
    modelId: '',
  }
  const inList = sessions.some((s) => s.sessionId === sessionId)
  if (!inList) {
    sessions = [row as SessionItem, ...sessions]
  } else {
    sessions = sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, sessionFile: sessionFile ?? s.sessionFile, title } : s,
    )
  }
  store.setSessions(sessions as SessionItem[], workspaceId)
}
