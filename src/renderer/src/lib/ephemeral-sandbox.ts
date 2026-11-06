import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { selectViewSession } from '@renderer/stores/session-state'
import { materializePendingNewSession } from '@renderer/lib/new-session'
import { beginSessionNavigation, getSessionNavigationToken, isSessionNavigationCurrent } from '@renderer/lib/session-navigation'
import { sessionPreviewText } from '@shared/session-preview-text'

export function titleFromFirstMessage(text: string, maxLen = 48): string {
  const one = sessionPreviewText(text).trim()
  if (!one) return 'New chat'
  return one.length > maxLen ? `${one.slice(0, maxLen)}…` : one
}

/** 临时对话首条消息：建 sandbox → 打开工作区 → 返回新 sessionFile（标题=首条消息） */
export async function finalizeEphemeralSandboxOnFirstSend(
  firstMessage: string,
  origin = { state: useUIStore.getState(), navigationToken: getSessionNavigationToken() },
): Promise<string> {
  const store = origin.state
  if (!store.ephemeralSandboxDraft) {
    throw new Error('Not in ephemeral sandbox draft')
  }
  const label = titleFromFirstMessage(firstMessage)
  const res = await ipcClient.invoke('workspace.sandbox.create', { label })
  const box = res?.sandbox as { path: string; label: string } | undefined
  if (!box?.path) throw new Error('sandbox.create failed')

  const current = useUIStore.getState()
  if (isSessionNavigationCurrent(origin.navigationToken) &&
      current.currentWorkspace === store.currentWorkspace &&
      current.currentSessionId === store.currentSessionId &&
      current.historySessionFile === store.historySessionFile) {
    // The sandbox draft (with its optimistic first turn) follows the view into the new workspace.
    const draftState = selectViewSession(useUIStore.getState())
    store.clearEphemeralSandboxDraft()
    const navigationToken = beginSessionNavigation()
    // 不阻塞等 Worker init；乐观 UI 已展示，prompt.send 前 materialize 会 session.new
    if (current.currentWorkspace !== box.path) {
      void ipcClient.invoke('workspace.open', { path: box.path }).catch((e) => console.error(e))
    }
    store.setWorkspace(box.path)
    store.adoptViewSessionState(draftState)
    origin = { state: useUIStore.getState(), navigationToken }
  }

  const sessionFile = await materializePendingNewSession(box.path, firstMessage, undefined, origin)

  window.dispatchEvent(new Event('pi-desktop:sandboxes-changed'))
  return sessionFile
}
