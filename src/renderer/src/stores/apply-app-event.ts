import type { AppEvent } from '@shared/app-events'
import { isSessionScopedAppEvent } from '@shared/app-event-session'
import {
  handleAgentError,
  handleCompaction,
  handleMessage,
  handleRun,
  handleSlash,
  handleTool,
} from '@renderer/stores/apply-app-event-handlers'
import type { StoreApi } from '@renderer/stores/apply-app-event-types'

export type { StoreApi } from '@renderer/stores/apply-app-event-types'

export function applyAppEvent(event: AppEvent, api: StoreApi): void {
  if (!isSessionScopedAppEvent(event)) return
  const state = api.get()
  const viewSid = state.currentSessionId
  const workerSid = state.workerLiveSnapshot.sessionId
  const evSid = event.sessionId
  if (evSid && viewSid && workerSid && evSid === workerSid && evSid !== viewSid) {
    if (event.type === 'run') {
      if (event.phase === 'running' || event.phase === 'started') {
        state.setWorkerLiveSnapshot({ ...state.workerLiveSnapshot, status: 'running' })
      } else if (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled') {
        state.setWorkerLiveSnapshot({
          ...state.workerLiveSnapshot,
          status: event.phase === 'failed' ? 'failed' : 'idle',
        })
      }
    }
    return
  }
  if (evSid && viewSid && evSid !== viewSid) return

  switch (event.type) {
    case 'message':
      handleMessage(event, api)
      break
    case 'tool':
      handleTool(event, api)
      break
    case 'file':
      state.addFileChange({
        path: event.path,
        source: event.source,
        changeType: event.changeType,
        turnId: event.turnId,
        runId: event.runId,
      })
      break
    case 'run':
      handleRun(event, api)
      break
    case 'compaction':
      handleCompaction(event, api)
      break
    case 'slash':
      handleSlash(event, api)
      break
    case 'queue':
      if (Date.now() < state.ignoreQueueSyncUntil) {
        const hasQueued = (event.steering?.length ?? 0) > 0 || (event.followUp?.length ?? 0) > 0
        if (hasQueued) break
      }
      state.setPendingQueue(event.steering, event.followUp)
      break
    case 'agent_error':
      handleAgentError(event, api)
      break
  }
}