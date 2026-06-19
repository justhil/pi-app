import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { syncRunStateFromWorker } from '@renderer/lib/sync-run-state'

/**
 * Switch UI + Worker to a pi session JSONL file.
 * History in Timeline is display-only unless Worker loads the same file via session.open.
 */
export async function openSessionIntoWorker(sessionId: string, sessionFile?: string): Promise<void> {
  const store = useUIStore.getState()
  store.setCurrentSession(sessionId)
  store.clearTimeline()
  store.clearFileChanges()
  store.setRunState({ status: 'idle', activeTool: undefined })

  if (!sessionFile) {
    store.loadHistoryItems([])
    return
  }

  try {
    await ipcClient.invoke('session.open', { sessionId, sessionFile })
    await syncRunStateFromWorker()
    const res = await ipcClient.invoke('session.getMessages', { sessionFile })
    store.loadHistoryItems(res?.items || [])
  } catch (e) {
    console.error('[openSession] failed:', e)
    store.loadHistoryItems([])
  }
}