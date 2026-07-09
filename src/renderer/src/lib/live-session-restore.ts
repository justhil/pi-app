import type { RunState } from '@renderer/stores/ui-store-types'
import type { LiveSessionTimelineSnapshot } from '@renderer/lib/live-session-timeline-cache'
import type { WorkerLiveSnapshot } from '@renderer/lib/session-worker-sync'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

export function isLiveSessionTurnActive(
  sessionFile: string,
  live: LiveSessionTimelineSnapshot | null,
  workerSnap: WorkerLiveSnapshot | null,
): boolean {
  if (!live) return false
  const boundToWorker = sessionFilesEqual(workerSnap?.sessionFile, sessionFile)
  const workerStillRunningHere = boundToWorker && workerSnap!.status === 'running'
  // Multi-session: workerLiveSnapshot is often the *foreground* slot, not this session.
  // Trust live cache / streaming ids even when worker snap points elsewhere.
  return (
    workerStillRunningHere ||
    live.runState.status === 'running' ||
    live.streamingAssistantId != null ||
    live.optimisticPendingUserText != null ||
    live.agentTurnBootstrapping
  )
}

/** 切回会话：Worker 仍在跑时优先 runtime，避免 cache 里过早 idle 把 UI 停掉 */
export function mergeLiveViewRunState(
  sessionFile: string,
  live: LiveSessionTimelineSnapshot,
  workerSnap: WorkerLiveSnapshot | null,
): RunState {
  const bound = sessionFilesEqual(workerSnap?.sessionFile, sessionFile)
  if (bound && workerSnap?.status === 'running') {
    return {
      ...live.runState,
      status: 'running',
    }
  }
  // Multi-session: this session's live cache is authoritative even if worker snap is another session.
  if (
    live.runState.status === 'running' ||
    live.streamingAssistantId != null ||
    live.optimisticPendingUserText != null ||
    live.agentTurnBootstrapping
  ) {
    return { ...live.runState, status: 'running' }
  }
  return live.runState
}