import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

export function titleFromFirstMessage(text: string, maxLen = 48): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return '临时对话'
  return one.length > maxLen ? `${one.slice(0, maxLen)}…` : one
}

/** 首条消息前创建 sandbox 目录、打开 Worker，并用首条消息作标题 */
export async function finalizeEphemeralSandboxOnFirstSend(firstMessage: string): Promise<string> {
  const store = useUIStore.getState()
  if (!store.ephemeralSandboxDraft) {
    throw new Error('Not in ephemeral sandbox draft')
  }
  const label = titleFromFirstMessage(firstMessage)
  const res = await ipcClient.invoke('workspace.sandbox.create', { label })
  const box = res?.sandbox as { path: string; label: string } | undefined
  if (!box?.path) throw new Error('sandbox.create failed')

  store.clearEphemeralSandboxDraft()
  await ipcClient.invoke('workspace.open', { path: box.path, awaitWorker: true })
  store.setWorkspace(box.path)

  const { startNewSession } = await import('@renderer/lib/new-session')
  await startNewSession(box.path)

  window.dispatchEvent(new Event('pi-desktop:sandboxes-changed'))
  return box.path
}