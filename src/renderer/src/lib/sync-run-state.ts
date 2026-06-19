import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

/** Pull model + thinking from Worker session after init / workspace open. */
export async function syncRunStateFromWorker(): Promise<void> {
  try {
    const res = await ipcClient.invoke('runtime.getState' as any)
    const st = res?.state
    if (!st) return
    const patch: { model?: string; thinkingLevel?: string } = {}
    if (st.model !== undefined) patch.model = st.model
    if (st.thinkingLevel !== undefined) patch.thinkingLevel = st.thinkingLevel
    if (Object.keys(patch).length) useUIStore.getState().setRunState(patch)
  } catch {
    /* worker not ready */
  }
}