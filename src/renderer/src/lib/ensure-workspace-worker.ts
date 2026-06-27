import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { resolveBootWorkspaceState } from '@renderer/lib/boot-workspace-state'
let bootstrapping: Promise<void> | null = null

/**
 * 应用首屏启动链（Renderer mount 时调用一次）：
 * 1. 读 persist 的 currentWorkspace
 * 2. resolveBootWorkspaceState → 无项目/沙箱 → enterEphemeralSandboxDraft（新对话首页，Composer 可输入）
 * 3. 磁盘项目 → setWorkspace + workspace.ensureWorker（Main fork Worker，不阻塞窗口）
 */
export function ensureWorkspaceWorkerOnBoot(): Promise<void> {
  if (bootstrapping) return bootstrapping
  bootstrapping = (async () => {
    const persisted = useUIStore.getState().currentWorkspace
    const boot = resolveBootWorkspaceState(persisted)
    if (boot.ephemeralDraft) {
      void ipcClient.invoke('settings.set', { key: 'currentProject', value: null }).catch(() => {})
      useUIStore.getState().enterEphemeralSandboxDraft()
      queueMicrotask(() => void refreshComposerRunDisplay())
      return
    }
    const path = boot.workspace
    if (!path || !boot.shouldStartWorker) return
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