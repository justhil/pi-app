import { ipcClient } from '@renderer/lib/ipc-client'
import { applyComposerAbortUi } from '@renderer/lib/composer-queue-restore'
import { fetchWorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'
import { useUIStore } from '@renderer/stores/ui-store'

let abortCooldownUntil = 0

export function isComposerAbortCooldown(): boolean {
  return Date.now() < abortCooldownUntil
}

/** 单次 Worker abort（内含 clearQueue）；避免 clearQueue + abort 双 RPC */
export async function abortAgentTurn(opts?: {
  restoreEditorText?: string
  setEditorText?: (v: string) => void
}): Promise<void> {
  if (isComposerAbortCooldown()) return
  abortCooldownUntil = Date.now() + 700

  const store = useUIStore.getState()
  const queued = [...store.pendingSteering, ...store.pendingFollowUp].filter(Boolean)
  const merged = [queued.join('\n'), (opts?.restoreEditorText || '').trim()].filter(Boolean).join('\n')

  applyComposerAbortUi()
  store.setWorkerLiveSnapshot({ ...store.workerLiveSnapshot, status: 'idle' })

  if (merged && opts?.setEditorText) opts.setEditorText(merged)

  try {
    await ipcClient.invoke('prompt.abort', { sessionId: '' })
  } catch (e) {
    console.error('[composer-abort] prompt.abort failed:', e)
  }

  window.setTimeout(() => {
    void fetchWorkerLiveSnapshot()
      .then((snap) => useUIStore.getState().setWorkerLiveSnapshot(snap))
      .catch(() => {})
  }, 250)
}