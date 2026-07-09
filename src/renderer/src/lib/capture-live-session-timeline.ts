import {
  getLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { captureFocusFromUiStore } from '@renderer/lib/session-shell'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

export function captureVisibleLiveSessionTimeline(): void {
  // Always snapshot display into Session Shell cache (idle or running) for instant switch-back.
  captureFocusFromUiStore()

  const state = useUIStore.getState()
  const viewFile = state.historySessionFile
  const workerFile = state.workerLiveSnapshot.sessionFile
  const workerSnap = state.workerLiveSnapshot

  // Multi-session: capture live stream cache when the visible session is active.
  if (viewFile) {
    const sessionRuntimeRunning = state.sessionRuntimeRunning?.[viewFile] === true
    const live =
      state.streamingAssistantId != null ||
      state.optimisticPendingUserText != null ||
      sessionRuntimeRunning ||
      (sessionFilesEqual(workerFile, viewFile) && workerSnap.status === 'running')
    if (live) {
      flushStreamPendingSync(useUIStore.getState, useUIStore.setState)
      const latest = useUIStore.getState()
      const snap = {
        sessionId: latest.currentSessionId,
        sessionFile: viewFile,
        timelineItems: latest.timelineItems,
        streamingAssistantId: latest.streamingAssistantId,
        runState: latest.runState,
        pendingSteering: latest.pendingSteering,
        pendingFollowUp: latest.pendingFollowUp,
        optimisticPendingUserText: latest.optimisticPendingUserText,
        agentTurnBootstrapping: latest.agentTurnBootstrapping,
      }
      saveLiveSessionTimeline(snap)
      patchSessionTimelineView(viewFile, {
        sessionId: snap.sessionId,
        tail: snap.timelineItems,
        streamingAssistantId: snap.streamingAssistantId,
        runState: snap.runState,
        pendingSteering: snap.pendingSteering,
        pendingFollowUp: snap.pendingFollowUp,
        optimisticPendingUserText: snap.optimisticPendingUserText,
        agentTurnBootstrapping: snap.agentTurnBootstrapping,
      })
      return
    }
  }

  // Leaving a preview while a *different* worker session is still running: keep its cache warm.
  if (!workerFile || workerSnap.status !== 'running') return
  if (viewFile && workerFile === viewFile) return
  const cached = getLiveSessionTimeline(workerFile)
  if (!cached) return
  if (
    cached.runState.status !== 'running' &&
    cached.streamingAssistantId == null &&
    cached.optimisticPendingUserText == null
  ) {
    return
  }
  saveLiveSessionTimeline({
    ...cached,
    runState: { ...cached.runState, status: 'running' },
  })
}
