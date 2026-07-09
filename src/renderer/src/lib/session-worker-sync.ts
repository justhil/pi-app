import { ipcClient } from '@renderer/lib/ipc-client'
import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { RunState } from '@renderer/stores/ui-store-types'

export type WorkerLiveSnapshot = {
  sessionId: string | null
  sessionFile: string | null
  status: 'idle' | 'running' | 'failed'
}

function runtimeRunningForSession(
  viewFile: string | null | undefined,
  sessionRuntimeRunning?: Record<string, boolean> | null,
): boolean {
  if (!viewFile || !sessionRuntimeRunning) return false
  const viewKey = normalizeSessionFileKey(viewFile)
  if (sessionRuntimeRunning[viewFile] === true || sessionRuntimeRunning[viewKey] === true) return true
  return Object.entries(sessionRuntimeRunning).some(
    ([runtimeKey, running]) => running && sessionFilesEqual(runtimeKey, viewFile),
  )
}

/**
 * Poll runtime for a session (or foreground if sessionFile omitted).
 *
 * Never invent "running" for a requested session when the worker reply is for another
 * sessionFile (or missing). That was the flaky switch-away running bug.
 */
export async function fetchWorkerLiveSnapshot(
  workspaceId?: string | null,
  sessionFile?: string | null,
): Promise<WorkerLiveSnapshot> {
  const requested = sessionFile ? normalizeSessionFileKey(sessionFile) || sessionFile : null
  const payload: { workspaceId?: string; sessionFile?: string } = {}
  if (workspaceId) payload.workspaceId = workspaceId
  if (sessionFile) payload.sessionFile = sessionFile

  const r = await ipcClient
    .invoke('runtime.getState', Object.keys(payload).length ? payload : undefined)
    .catch(() => null)
  const st = r?.state as
    | { sessionId?: string; sessionFile?: string; isStreaming?: boolean }
    | null
    | undefined

  if (!st) {
    return { sessionId: null, sessionFile: requested, status: 'idle' }
  }

  const repliedFile = st.sessionFile ? normalizeSessionFileKey(st.sessionFile) || st.sessionFile : null
  const streaming = st.isStreaming === true

  if (requested) {
    if (repliedFile && !sessionFilesEqual(repliedFile, requested)) {
      return { sessionId: null, sessionFile: requested, status: 'idle' }
    }
    return {
      sessionId: st.sessionId ?? null,
      sessionFile: requested,
      status: streaming ? 'running' : 'idle',
    }
  }

  return {
    sessionId: st.sessionId ?? null,
    sessionFile: repliedFile,
    status: streaming ? 'running' : 'idle',
  }
}

export function isViewingDifferentSessionThanWorker(
  viewSessionFile: string | null | undefined,
  workerSessionFile: string | null | undefined,
): boolean {
  if (!viewSessionFile) return false
  if (!workerSessionFile) return false
  return !sessionFilesEqual(viewSessionFile, workerSessionFile)
}

export function isSessionPreviewComposeLocked(
  _viewSessionFile?: string | null,
  _workerSessionFile?: string | null,
  _workerStatus?: WorkerLiveSnapshot['status'],
): boolean {
  return false
}

export function isViewingWorkerBoundSession(
  viewSessionFile: string | null | undefined,
  workerSessionFile: string | null | undefined,
): boolean {
  return sessionFilesEqual(viewSessionFile, workerSessionFile)
}

export function canAbortWorkerTurn(
  viewSessionFile: string | null | undefined,
  snap: WorkerLiveSnapshot,
  viewRunning = false,
  sessionRuntimeRunning?: Record<string, boolean> | null,
): boolean {
  if (runtimeRunningForSession(viewSessionFile, sessionRuntimeRunning)) return true
  const workerBoundHere = isViewingWorkerBoundSession(viewSessionFile, snap.sessionFile)
  if (workerBoundHere && snap.status === 'running') return true
  // viewRunning is residual global UI — only honor when worker is bound here
  if (viewRunning && workerBoundHere && snap.status === 'running') return true
  return false
}

/**
 * Composer stop / top-bar "running" for the *visible* session only.
 *
 * Multi-session authority (in order):
 * 1. sessionRuntimeRunning[view]  — set from AppEvents scoped by sessionFile
 * 2. workerLiveSnapshot bound to view && running
 * 3. local streaming markers (optimistic / streamingAssistantId) when worker is not foreign
 *
 * NEVER trust global runState.status alone — residual after switch caused flaky chrome/composer.
 */
export function composerTurnActive(input: {
  historySessionFile: string | null
  workerLiveSnapshot: WorkerLiveSnapshot
  runState: { status: string }
  streamingAssistantId: string | null
  optimisticPendingUserText: string | null
  sessionRuntimeRunning?: Record<string, boolean> | null
  agentTurnBootstrapping?: boolean
}): boolean {
  const viewFile = input.historySessionFile
  if (runtimeRunningForSession(viewFile, input.sessionRuntimeRunning)) return true

  const workerFile = input.workerLiveSnapshot.sessionFile
  const workerRunning = input.workerLiveSnapshot.status === 'running'
  const workerBoundHere = sessionFilesEqual(viewFile, workerFile)

  if (workerBoundHere && workerRunning) return true

  const localStreaming =
    input.streamingAssistantId != null ||
    input.optimisticPendingUserText != null ||
    input.agentTurnBootstrapping === true

  if (localStreaming) {
    // Foreign worker snap must not keep Stop lit for an idle view with cleared markers —
    // but if markers exist they belong to the current view (openSession clears on switch).
    if (viewFile && workerFile && !sessionFilesEqual(viewFile, workerFile) && workerRunning) {
      // Local markers + foreign running worker: still show active if markers present
      // (user just switched mid-send onto a session that has optimistic UI). Keep true.
    }
    return true
  }

  // Explicitly ignore residual runState.status === 'running'
  return false
}

/** Only sync runState from worker when snap is for the viewed session. */
export function syncViewRunStateFromWorkerSnapshot(
  viewSessionFile: string | null | undefined,
  snap: WorkerLiveSnapshot,
  setRunState: (patch: {
    status: 'idle' | 'running' | 'failed'
    activeTool?: undefined
    activeToolStatus?: undefined
    activeRunId?: undefined
  }) => void,
): void {
  if (!isViewingWorkerBoundSession(viewSessionFile, snap.sessionFile)) return
  if (isAbortUiHoldActive()) {
    setRunState({
      status: 'idle',
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: undefined,
    })
    return
  }
  if (snap.status === 'running') {
    setRunState({ status: 'running', activeTool: undefined, activeToolStatus: undefined })
  } else {
    setRunState({
      status: snap.status === 'failed' ? 'failed' : 'idle',
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: undefined,
    })
  }
}

export function normalizeWorkerLiveSnapshotForView(snap: WorkerLiveSnapshot): WorkerLiveSnapshot {
  if (!isAbortUiHoldActive()) return snap
  return { ...snap, status: 'idle' }
}

type ViewStore = {
  historySessionFile: string | null
  runState: RunState
  setWorkerLiveSnapshot: (snap: WorkerLiveSnapshot) => void
  setRunState: (patch: Partial<RunState>) => void
}

/**
 * Apply worker snap only when it is for the viewed session.
 * Foreign running snaps never overwrite current view identity or re-light runState.
 */
export function applyLiveSnapshotToView(
  viewSessionFile: string | null | undefined,
  snap: WorkerLiveSnapshot,
  store: ViewStore,
): void {
  const normalized = normalizeWorkerLiveSnapshotForView(snap)

  if (viewSessionFile) {
    if (normalized.sessionFile && !sessionFilesEqual(normalized.sessionFile, viewSessionFile)) {
      store.setWorkerLiveSnapshot({
        sessionId: null,
        sessionFile: viewSessionFile,
        status: 'idle',
      })
      return
    }
    // Unscoped running snap is untrusted under multi-session
    if (!normalized.sessionFile && normalized.status === 'running') {
      return
    }
  }

  const boundSnap: WorkerLiveSnapshot = {
    ...normalized,
    sessionFile: normalized.sessionFile ?? viewSessionFile ?? null,
  }

  store.setWorkerLiveSnapshot(boundSnap)
  syncViewRunStateFromWorkerSnapshot(viewSessionFile, boundSnap, (p) => store.setRunState(p))
}

export function resetVisibleComposerTurnState(set: {
  setRunState: (patch: Partial<RunState>) => void
}): void {
  set.setRunState({
    status: 'idle',
    activeTool: undefined,
    activeToolStatus: undefined,
    activeRunId: undefined,
  })
}
