import { ipcClient } from '@renderer/lib/ipc-client'
import { applyComposerAbortUi } from '@renderer/lib/composer-queue-restore'
import { markAbortUiHold } from '@renderer/lib/abort-ui-hold'
import { applyLiveSnapshotToView, composerTurnActive, fetchWorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'
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
  const sessionFile = store.historySessionFile
  if (
    !composerTurnActive({
      historySessionFile: sessionFile,
      workerLiveSnapshot: store.workerLiveSnapshot,
      runState: store.runState,
      streamingAssistantId: store.streamingAssistantId,
      optimisticPendingUserText: store.optimisticPendingUserText,
      sessionRuntimeRunning: store.sessionRuntimeRunning,
      agentTurnBootstrapping: store.agentTurnBootstrapping,
    })
  )
    return
  const queued = [...store.pendingSteering, ...store.pendingFollowUp].filter(Boolean)
  const merged = [queued.join('\n'), (opts?.restoreEditorText || '').trim()].filter(Boolean).join('\n')

  markAbortUiHold()
  applyComposerAbortUi()

  if (merged && opts?.setEditorText) opts.setEditorText(merged)

  try {
    const result = await ipcClient.invoke('prompt.abort', {
      sessionId: '',
      sessionFile: sessionFile ?? undefined,
    })
    if (result && (result as { ignored?: boolean }).ignored) {
      console.warn('[composer-abort] prompt.abort ignored by main', result)
      // Force local idle again — user clicked Stop; never leave chrome stuck running.
      applyComposerAbortUi()
    }
  } catch (e) {
    console.error('[composer-abort] prompt.abort failed:', e)
    applyComposerAbortUi()
  }

  // Do not re-apply a late getState that might re-light running for this session
  // until the worker has settled; only refresh if still focused here.
  window.setTimeout(() => {
    void fetchWorkerLiveSnapshot(useUIStore.getState().currentWorkspace, sessionFile)
      .then((snap) => {
        const s = useUIStore.getState()
        if (sessionFile && s.historySessionFile !== sessionFile) return
        // Abort holds UI idle; ignore streaming=true for a short hold window
        applyLiveSnapshotToView(s.historySessionFile, { ...snap, status: 'idle' }, s)
      })
      .catch(() => {})
  }, 250)
}