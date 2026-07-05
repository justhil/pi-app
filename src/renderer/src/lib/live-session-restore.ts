import type { RunState } from '@renderer/stores/ui-store-types'
import type { LiveSessionTimelineSnapshot } from '@renderer/lib/live-session-timeline-cache'
import type { WorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'

export function isLiveSessionTurnActive(
  sessionFile: string,
  live: LiveSessionTimelineSnapshot | null,
  workerSnap: WorkerLiveSnapshot | null,
): boolean {
  if (!live) return false
  const boundToWorker = !!workerSnap?.sessionFile && workerSnap.sessionFile === sessionFile
  const workerStillRunningHere = boundToWorker && workerSnap!.status === 'running'
  return (
    workerStillRunningHere ||
    live.runState.status === 'running' ||
    live.streamingAssistantId != null ||
    live.optimisticPendingUserText != null
  )
}

/** 切回会话：Worker 仍在跑时优先 runtime，避免 cache 里过早 idle 把 UI 停掉 */
export function mergeLiveViewRunState(
  sessionFile: string,
  live: LiveSessionTimelineSnapshot,
  workerSnap: WorkerLiveSnapshot | null,
): RunState {
  const bound = workerSnap?.sessionFile === sessionFile
  if (bound && workerSnap?.status === 'running') {
    return {
      ...live.runState,
      status: 'running',
    }
  }
  if (live.streamingAssistantId != null || live.optimisticPendingUserText != null) {
    if (live.runState.status !== 'running') {
      return { ...live.runState, status: 'running' }
    }
  }
  return live.runState
}