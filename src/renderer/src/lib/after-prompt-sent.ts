import { ipcClient } from '@renderer/lib/ipc-client'
import { clearSessionHistoryCache } from '@renderer/lib/session-history'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { applyWorkerBoundModelDisplay } from '@renderer/lib/session-display-meta'
import { useUIStore } from '@renderer/stores/ui-store'

/** Optional bind result from prompt.send / steer / followUp after Worker loadSession. */
export type PromptBindResult = {
  model?: string
  thinkingLevel?: string
  modelFallbackMessage?: string
} | null | undefined

/** prompt.send 返回后：同步 Worker 真实模型、解除 pendingBind，不重载历史 */
export async function afterPromptSent(bind?: PromptBindResult): Promise<void> {
  if (bind && (bind.model != null || bind.modelFallbackMessage || bind.thinkingLevel != null)) {
    applyWorkerBoundModelDisplay(bind)
  } else {
    // Ensure display tracks runtime after first bind (even if IPC omitted fields)
    const { applyComposerDisplayMeta } = await import('@renderer/lib/session-display-meta')
    await applyComposerDisplayMeta(null)
  }
  const file = useUIStore.getState().historySessionFile
  if (file) clearSessionHistoryCache(file)
  else clearSessionHistoryCache()
  await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  if (file) void refreshSessionTree(file)
}