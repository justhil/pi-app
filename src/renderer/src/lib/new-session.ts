import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** 新建会话：Worker 新 session + 空 Timeline，等待用户输入 */
export async function startNewSession(workspaceId: string): Promise<void> {
  if (!workspaceId) return
  const store = useUIStore.getState()

  const res = await ipcClient.invoke('session.new', { workspaceId })
  const sessionId = res?.session?.sessionId
  if (!sessionId) {
    throw new Error('session.new returned no sessionId')
  }

  const sessionFile = res?.session?.sessionFile as string | undefined

  store.setCurrentSession(sessionId)
  store.loadHistoryItems([])
  store.clearFileChanges()

  const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
  await refreshComposerRunDisplay()

  const listRes = await ipcClient.invoke('session.list', { workspaceId })
  let sessions = listRes?.sessions || []
  const inList = sessions.some((s: { sessionId: string }) => s.sessionId === sessionId)
  if (!inList) {
    sessions = [
      {
        sessionId,
        sessionFile,
        workspaceId,
        title: '新会话',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ...sessions,
    ]
  } else if (sessionFile) {
    sessions = sessions.map((s: { sessionId: string; sessionFile?: string }) =>
      s.sessionId === sessionId ? { ...s, sessionFile } : s,
    )
  }
  store.setSessions(sessions)
}