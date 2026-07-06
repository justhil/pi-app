import {
  getLiveSessionTimeline,
  saveLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { useUIStore } from '@renderer/stores/ui-store'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

export function captureVisibleLiveSessionTimeline(): void {
  const state = useUIStore.getState()
  const viewFile = state.historySessionFile
  const workerFile = state.workerLiveSnapshot.sessionFile
  const workerSnap = state.workerLiveSnapshot

  if (viewFile && (!workerFile || workerFile === viewFile)) {
    const live =
      state.runState.status === 'running' ||
      state.streamingAssistantId != null ||
      (workerFile === viewFile && workerSnap.status === 'running')
    if (!live) return

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

  if (!workerFile || workerSnap.status !== 'running') return
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
