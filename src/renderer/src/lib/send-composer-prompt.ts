import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export async function sendComposerPrompt(text: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) return false
  let store = useUIStore.getState()
  if (store.pendingNewSessionPlaceholder && store.currentWorkspace) {
    const { materializePendingNewSession } = await import('@renderer/lib/new-session')
    await materializePendingNewSession(store.currentWorkspace, trimmed)
    store = useUIStore.getState()
  }
  const bind = await ipcClient.invoke('prompt.send', {
    sessionId: store.currentSessionId || '',
    sessionFile: store.historySessionFile ?? undefined,
    text: trimmed,
  })
  const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
  await afterPromptSent(bind)
  return true
}
