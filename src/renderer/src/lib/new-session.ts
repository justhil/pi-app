import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { titleFromFirstMessage } from '@renderer/lib/ephemeral-sandbox'
import { enterBlankSession } from '@renderer/lib/blank-session-transition'
import { workspacePathsEqual } from '@shared/workspace-path'

/** 侧栏「新会话」：仅占位，不碰 Worker */
export function enterNewSessionPlaceholder(): void {
  enterBlankSession('pending-project')
}

/** 首条消息：创建真实 session，并在拿到 sessionFile 后立即回调。 */
export async function materializePendingNewSession(
  workspaceId: string,
  firstMessage: string,
  onSessionCreated?: (sessionFile: string) => void,
): Promise<void> {
  if (!workspaceId) return
  const store = useUIStore.getState()

  const title = titleFromFirstMessage(firstMessage, 48) || '新会话'

  const res = await ipcClient.invoke('session.new', { workspaceId })
  const sessionId = res?.session?.sessionId
  if (!sessionId) throw new Error('session.new returned no sessionId')

  const sessionFile = res?.session?.sessionFile as string | undefined

  store.clearPendingNewSessionPlaceholder()
  store.setCurrentSession(sessionId)
  // Sidebar shows the new row (titled by the first message) the moment it exists — not after
  // the session.list round-trip below.
  insertSessionRowOptimistically(workspaceId, { sessionId, sessionFile, title })
  // 勿 loadHistoryItems([])：首条发送前 Composer 已 append 乐观气泡
  store.clearFileChanges()
  if (sessionFile) {
    store.setHistoryMeta(0, 0, sessionFile)
    onSessionCreated?.(sessionFile)
    // session.new 后 Worker 已是新会话，勿 setPendingBind（否则 prompt.send 会再 loadSession 卡很久）
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

  const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
  void refreshComposerRunDisplay()

  // The sidebar list only needs to show the new row; never hold the first prompt for it.
  void refreshNewSessionInList(workspaceId, { sessionId, sessionFile, title })
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
