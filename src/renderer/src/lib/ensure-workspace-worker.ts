import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { resolveBootWorkspaceState } from '@renderer/lib/boot-workspace-state'
let bootstrapping: Promise<void> | null = null

/**
 * Application first-paint boot (called once on Renderer mount):
 * 1. Read persisted currentWorkspace
 * 2. resolveBootWorkspaceState → no project/sandbox → ephemeral draft home
 * 3. Disk project → setWorkspace + restore UI metadata only (no Worker until a Worker-required action)
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
    if (!path) return
    useUIStore.getState().setWorkspace(path)
    // Persist selection without forking a pi Worker; prompt/session.new/model ops start it lazily.
    void ipcClient.invoke('settings.set', { key: 'currentProject', value: path }).catch(() => {})
    try {
      await refreshComposerRunDisplay()
    } catch (error) {
      console.error('[ensureWorkspaceWorkerOnBoot]', error)
    }
  })()
  return bootstrapping
}
