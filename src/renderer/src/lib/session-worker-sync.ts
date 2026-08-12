import { ipcClient } from '@renderer/lib/ipc-client'
import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'
import type { RunState } from '@renderer/stores/ui-store-types'

export type WorkerLiveSnapshot = {
  sessionId: string | null
  sessionFile: string | null
  status: 'idle' | 'running' | 'failed' | 'unknown'
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
    // IPC 失败/无响应与 worker 明确 idle 是两回事：失败必须保留旧状态，
    // 否则一次瞬态查询失败就会清掉运行态并停掉轮询，正在跑的任务失去停止入口。
    return { sessionId: null, sessionFile: requested, status: 'unknown' }
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
  viewSessionFile?: string | null,
  _workerSessionFile?: string | null,
  _workerStatus?: WorkerLiveSnapshot['status'],
  readOnlyPreview = false,
): boolean {
  return readOnlyPreview && !!viewSessionFile
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
 *
 * Local optimistic markers are display data, not a session identity. They must not
 * authorize Stop after a view switch until one of the session-scoped signals above
 * confirms that the visible worker is running.
 *
 * NEVER trust global runState.status alone — residual after switch caused flaky chrome/composer.
 */
export function composerTurnActive(input: {
  historySessionFile: string | null
  workerLiveSnapshot: WorkerLiveSnapshot
  sessionRuntimeRunning?: Record<string, boolean> | null
}): boolean {
  const viewFile = input.historySessionFile
  if (!viewFile) return false
  if (runtimeRunningForSession(viewFile, input.sessionRuntimeRunning)) return true

  const workerFile = input.workerLiveSnapshot.sessionFile
  const workerRunning = input.workerLiveSnapshot.status === 'running'
  const workerBoundHere = sessionFilesEqual(viewFile, workerFile)

  if (workerBoundHere && workerRunning) return true

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
  if (isAbortUiHoldActive(viewSessionFile)) {
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
  } else if (snap.status === 'unknown') {
    // 查询失败：保留当前 runState，不降级为 idle
  } else {
    setRunState({
      status: snap.status === 'failed' ? 'failed' : 'idle',
      activeTool: undefined,
      activeToolStatus: undefined,
      activeRunId: undefined,
    })
  }
}

export function normalizeWorkerLiveSnapshotForView(
  snap: WorkerLiveSnapshot,
  viewSessionFile: string | null | undefined = snap.sessionFile,
): WorkerLiveSnapshot {
  if (!isAbortUiHoldActive(viewSessionFile)) return snap
  return { ...snap, status: 'idle' }
}

type ViewStore = {
  historySessionFile: string | null
  runState: RunState
  agentTurnBootstrapping?: boolean
  setWorkerLiveSnapshot: (snap: WorkerLiveSnapshot) => void
  setRunState: (patch: Partial<RunState>) => void
  reconcileSessionRuntimeIdle?: (sessionFile: string) => void
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
  const normalized = normalizeWorkerLiveSnapshotForView(snap, viewSessionFile)

  if (normalized.status === 'unknown') {
    // 查询失败/无响应：保留旧 snapshot 与运行态，等下一次成功轮询再收敛
    return
  }

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

  // A first-send poll can race ahead of the worker's run.started event. Ignore
  // that idle sample completely; once a run id exists, a later idle is terminal.
  if (
    boundSnap.status === 'idle' &&
    store.agentTurnBootstrapping === true &&
    !store.runState.activeRunId
  ) {
    return
  }

  if (boundSnap.status !== 'running' && viewSessionFile) {
    store.reconcileSessionRuntimeIdle?.(viewSessionFile)
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
