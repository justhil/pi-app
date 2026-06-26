import { ipcClient } from '@renderer/lib/ipc-client'

export type WorkerLiveSnapshot = {
  sessionId: string | null
  sessionFile: string | null
  status: 'idle' | 'running' | 'failed'
}

export async function fetchWorkerLiveSnapshot(): Promise<WorkerLiveSnapshot> {
  const r = await ipcClient.invoke('runtime.getState').catch(() => null)
  const st = r?.state as { sessionId?: string; sessionFile?: string; isStreaming?: boolean } | null | undefined
  return {
    sessionId: st?.sessionId ?? null,
    sessionFile: st?.sessionFile ?? null,
    status: st?.isStreaming ? 'running' : 'idle',
  }
}

/** Worker 是否绑定在另一条会话（与 UI 当前时间线文件不一致） */
export function isViewingDifferentSessionThanWorker(
  viewSessionFile: string | null | undefined,
  workerSessionFile: string | null | undefined,
): boolean {
  if (!viewSessionFile) return false
  if (!workerSessionFile) return false
  return viewSessionFile !== workerSessionFile
}

/** 预览且禁止发送：仅当后台会话仍在跑（对齐「可切会话、后台继续；停了就能在别的会话发」） */
export function isSessionPreviewComposeLocked(
  viewSessionFile: string | null | undefined,
  workerSessionFile: string | null | undefined,
  workerStatus: WorkerLiveSnapshot['status'],
): boolean {
  return isViewingDifferentSessionThanWorker(viewSessionFile, workerSessionFile) && workerStatus === 'running'
}

export function isViewingWorkerBoundSession(
  viewSessionFile: string | null | undefined,
  workerSessionFile: string | null | undefined,
): boolean {
  if (!viewSessionFile || !workerSessionFile) return false
  return viewSessionFile === workerSessionFile
}

/** 切回 Worker 绑定会话时，用 runtime 状态对齐 Composer 停止键 / runState */
export function syncViewRunStateFromWorkerSnapshot(
  viewSessionFile: string | null | undefined,
  snap: WorkerLiveSnapshot,
  setRunState: (patch: { status: 'idle' | 'running' | 'failed'; activeTool?: undefined; activeToolStatus?: undefined }) => void,
): void {
  if (!isViewingWorkerBoundSession(viewSessionFile, snap.sessionFile)) return
  if (snap.status === 'running') {
    setRunState({ status: 'running', activeTool: undefined, activeToolStatus: undefined })
  } else {
    setRunState({ status: snap.status === 'failed' ? 'failed' : 'idle', activeTool: undefined, activeToolStatus: undefined })
  }
}