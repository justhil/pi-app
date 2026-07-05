import type { AppEvent } from '@shared/app-events'
import { isSessionScopedAppEvent } from '@shared/app-event-session'
import { applyBackgroundAppEventToLiveTimeline } from '@renderer/lib/live-session-timeline-cache'
import { resolveAppEventRoute } from '@renderer/stores/apply-app-event-route'
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

function backgroundCacheFile(state: ReturnType<StoreApi['get']>, event: AppEvent): string | null {
  if (!isSessionScopedAppEvent(event)) return null
  if (event.sessionFile) return event.sessionFile
  return state.workerLiveSnapshot.sessionFile
}

export function applyAppEvent(event: AppEvent, api: StoreApi): void {
  if (!isSessionScopedAppEvent(event)) return
  const state = api.get()
  const route = resolveAppEventRoute(state, event)
  if (route === 'drop') return
  if (route === 'background') {
    const cacheFile = backgroundCacheFile(state, event)
    if (cacheFile) applyBackgroundAppEventToLiveTimeline(cacheFile, event)
    return
  }

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