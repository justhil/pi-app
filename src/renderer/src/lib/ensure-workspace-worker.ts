import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'

let bootstrapping: Promise<void> | null = null

/**
 * 重启后 UI 可能已从 localStorage 恢复 currentWorkspace，但 Main 未 start Worker。
 * 在应用启动时调用，保证 Pi 设置 / 模型切换可用。
 */
export function ensureWorkspaceWorkerOnBoot(): Promise<void> {
  if (bootstrapping) return bootstrapping
  bootstrapping = (async () => {
    const path = useUIStore.getState().currentWorkspace
    if (!path) return
    useUIStore.getState().setWorkspace(path)
    try {
      const res = await ipcClient.invoke('workspace.ensureWorker', { path })
      if (!res?.ok) {
        console.warn('[ensureWorkspaceWorker] failed:', res?.error)
        return
      }
      if (res.model) {
        useUIStore.getState().setRunState({ model: res.model })
      }
      await refreshComposerRunDisplay()
    } catch (e) {
      console.error('[ensureWorkspaceWorker]', e)
    }
  })()
  return bootstrapping
}