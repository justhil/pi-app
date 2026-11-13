import { ipcClient } from '@renderer/lib/ipc-client'
import { applyComposerAbortUi } from '@renderer/lib/composer-queue-restore'
import {
  abortUiHoldRemainingMs,
  clearAbortQueueIgnore,
  clearAbortUiHold,
  isAbortUiHoldActive,
} from '@renderer/lib/abort-ui-hold'
import { applyLiveSnapshotToView, composerTurnActive, fetchWorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'

const abortCooldownUntil = new Map<string, number>()

export function isComposerAbortCooldown(sessionFile: string | null | undefined): boolean {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return false
  const until = abortCooldownUntil.get(key) ?? 0
  if (Date.now() < until) return true
  abortCooldownUntil.delete(key)
  return false
}

/** 单次 Worker abort（内含 clearQueue）；避免 clearQueue + abort 双 RPC */
export async function abortAgentTurn(opts?: {
  restoreEditorText?: string
  setEditorText?: (v: string) => void
}): Promise<void> {
  const store = useUIStore.getState()
  const sessionFile = store.historySessionFile
  if (!sessionFile) {
    // Allow cancelling a cold-start / pre-materialized pending send that has not bound a file yet.
    if (store.pendingTurnStage || store.agentTurnBootstrapping || store.optimisticPendingUserText) {
      useUIStore.setState({
        streamingAssistantId: null,
        agentTurnBootstrapping: false,
        pendingTurnStage: null,
        optimisticPendingUserText: null,
        runState: {
          ...store.runState,
          status: 'idle',
          activeRunId: undefined,
          activeTool: undefined,
          activeToolStatus: undefined,
        },
      })
      store.pruneEmptyAssistantBubbles()
    }
    return
  }
  if (isComposerAbortCooldown(sessionFile)) return
  const turnActive = composerTurnActive({
    historySessionFile: sessionFile,
    workerLiveSnapshot: store.workerLiveSnapshot,
    sessionRuntimeRunning: store.sessionRuntimeRunning,
  })
  const hasLocalOutbound =
    !!store.pendingTurnStage ||
    store.agentTurnBootstrapping ||
    store.optimisticPendingUserText != null
  if (!turnActive && !hasLocalOutbound) return
  abortCooldownUntil.set(normalizeSessionFileKey(sessionFile), Date.now() + 500)
  const queued = [...store.pendingSteering, ...store.pendingFollowUp].filter(Boolean)
  const merged = [queued.join('\n'), (opts?.restoreEditorText || '').trim()].filter(Boolean).join('\n')

  applyComposerAbortUi(sessionFile)

  if (merged && opts?.setEditorText) opts.setEditorText(merged)

  let abortSettled = false
  try {
    const result = await ipcClient.invoke('prompt.abort', {
      sessionId: '',
      sessionFile: sessionFile ?? undefined,
    })
    if (result && (result as { ignored?: boolean }).ignored) {
      console.warn('[composer-abort] prompt.abort ignored by main', result)
      // Force local idle again — user clicked Stop; never leave chrome stuck running.
      if (isAbortUiHoldActive(sessionFile)) applyComposerAbortUi(sessionFile)
    } else {
      abortSettled = true
    }
  } catch (e) {
    console.error('[composer-abort] prompt.abort failed:', e)
    if (isAbortUiHoldActive(sessionFile)) applyComposerAbortUi(sessionFile)
  }

  // Once prompt.abort resolves cleanly and the worker reports idle, release the hold mask early
  // so a quick re-send / rewind never runs under a lingering suppression timer.
  if (abortSettled) {
    try {
      const snap = await fetchWorkerLiveSnapshot(useUIStore.getState().currentWorkspace, sessionFile)
      const s = useUIStore.getState()
      if (snap.status === 'idle') {
        clearAbortUiHold(sessionFile)
        clearAbortQueueIgnore(sessionFile)
        if (sessionFilesEqual(s.historySessionFile, sessionFile)) {
          applyLiveSnapshotToView(s.historySessionFile, snap, s)
        }
        return
      }
    } catch {
      /* fall through to hold-expiry probe */
    }
  }

  // Do not re-apply a late getState that might re-light running for this session
  // until the worker has settled; only refresh if still focused here.
  window.setTimeout(() => {
    if (!isAbortUiHoldActive(sessionFile)) return
    void fetchWorkerLiveSnapshot(useUIStore.getState().currentWorkspace, sessionFile)
      .then((snap) => {
        const s = useUIStore.getState()
        if (!sessionFilesEqual(s.historySessionFile, sessionFile)) return
        if (!isAbortUiHoldActive(sessionFile)) return
        if (snap.status === 'idle') {
          clearAbortUiHold(sessionFile)
          clearAbortQueueIgnore(sessionFile)
          applyLiveSnapshotToView(s.historySessionFile, snap, s)
          return
        }
        // Abort holds UI idle; ignore streaming=true for a short hold window
        applyLiveSnapshotToView(s.historySessionFile, { ...snap, status: 'idle' }, s)
      })
      .catch(() => {})
  }, 250)

  // While the hold lasts, run.started/running events are dropped. If the turn survived the
  // stop (e.g. it was still in prompt preflight), nothing re-lights it afterwards — ask the
  // worker once the hold lapses so the view shows the real state and Stop works again.
  window.setTimeout(() => {
    if (isAbortUiHoldActive(sessionFile)) return
    void fetchWorkerLiveSnapshot(useUIStore.getState().currentWorkspace, sessionFile)
      .then((snap) => {
        const s = useUIStore.getState()
        if (!sessionFilesEqual(s.historySessionFile, sessionFile)) return
        if (isAbortUiHoldActive(sessionFile)) return
        applyLiveSnapshotToView(s.historySessionFile, snap, s)
      })
      .catch(() => {})
  }, abortUiHoldRemainingMs(sessionFile) + 50)
}
