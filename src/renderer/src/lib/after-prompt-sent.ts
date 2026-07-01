import { ipcClient } from '@renderer/lib/ipc-client'
import { clearSessionHistoryCache } from '@renderer/lib/session-history'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { useUIStore } from '@renderer/stores/ui-store'

/** prompt.send 返回后：只解除 pendingBind，不重载历史（避免与乐观时间线叠成多条用户消息） */
export async function afterPromptSent(): Promise<void> {
  const file = useUIStore.getState().historySessionFile
  if (file) clearSessionHistoryCache(file)
  else clearSessionHistoryCache()
  await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  if (file) void refreshSessionTree(file)
}