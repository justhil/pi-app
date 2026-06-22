import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { titleFromFirstMessage } from '@renderer/lib/ephemeral-sandbox'

/** 侧栏「新会话」：仅占位，不碰 Worker */
export function enterNewSessionPlaceholder(): void {
  useUIStore.getState().enterPendingNewSessionPlaceholder()
}

/** 首条消息：创建真实 session 并刷新侧栏 */
export async function materializePendingNewSession(workspaceId: string, firstMessage: string): Promise<void> {
  if (!workspaceId) return
  const store = useUIStore.getState()

  const title = titleFromFirstMessage(firstMessage, 48) || '新会话'

  const res = await ipcClient.invoke('session.new', { workspaceId })
  const sessionId = res?.session?.sessionId
  if (!sessionId) throw new Error('session.new returned no sessionId')

  const sessionFile = res?.session?.sessionFile as string | undefined

  store.clearPendingNewSessionPlaceholder()
  store.setCurrentSession(sessionId)
  // 勿 loadHistoryItems([])：首条发送前 Composer 已 append 乐观气泡
  store.clearFileChanges()
  if (sessionFile) {
    store.setHistoryMeta(0, 0, sessionFile)
    // session.new 后 Worker 已是新会话，勿 setPendingBind（否则 prompt.send 会再 loadSession 卡很久）
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }

  const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
  void refreshComposerRunDisplay()

  const listRes = await ipcClient.invoke('session.list', { workspaceId })
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
    sessions = [row as any, ...sessions]
  } else {
    sessions = sessions.map((s) =>
      s.sessionId === sessionId ? { ...s, sessionFile: sessionFile ?? s.sessionFile, title } : s,
    )
  }
  store.setSessions(sessions as any)
}