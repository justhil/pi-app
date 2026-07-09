import type { AppEvent } from '@shared/app-events'
import { isSessionScopedAppEvent } from '@shared/app-event-session'
import {
  applyBackgroundAppEventToLiveTimeline,
  getLiveSessionTimeline,
} from '@renderer/lib/live-session-timeline-cache'
import { patchSessionTimelineView } from '@renderer/lib/session-timeline-views'
import { resolveAppEventRoute } from '@renderer/stores/apply-app-event-route'
import { useUIStore } from '@renderer/stores/ui-store'
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

/**
 * Session key for runtime map / background cache.
 * Prefer event.sessionFile only — never fall back to workerLiveSnapshot (stale after switch).
 */
function eventSessionFile(event: AppEvent): string | null {
  if (!isSessionScopedAppEvent(event)) return null
  if (event.sessionFile) return event.sessionFile
  return null
}

export function applyAppEvent(event: AppEvent, api: StoreApi): void {
  if (!isSessionScopedAppEvent(event)) return
  const state = api.get()
  const route = resolveAppEventRoute(state, event)
  if (route === 'drop') return
  if (route === 'background') {
    const cacheFile = eventSessionFile(event)
    if (cacheFile) {
      applyBackgroundAppEventToLiveTimeline(cacheFile, event)
      const snap = getLiveSessionTimeline(cacheFile)
      if (snap) {
        patchSessionTimelineView(cacheFile, {
          sessionId: snap.sessionId,
          tail: snap.timelineItems,
          streamingAssistantId: snap.streamingAssistantId,
          runState: snap.runState,
          pendingSteering: snap.pendingSteering,
          pendingFollowUp: snap.pendingFollowUp,
          optimisticPendingUserText: snap.optimisticPendingUserText,
          agentTurnBootstrapping: snap.agentTurnBootstrapping,
        })
        if (event.type === 'run') {
          const running = event.phase === 'running' || event.phase === 'started'
          useUIStore.getState().setSessionRuntimeRunning(cacheFile, running)
          if (!running && (event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled')) {
            void import('@renderer/lib/desktop-alerts').then(({ signalDesktopAlert }) => {
              void signalDesktopAlert('run_idle', {
                title: 'pi Desktop · 后台会话结束',
                body: '有会话在后台运行结束',
                background: true,
              })
            })
          }
        }
      }
    }
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
    case 'run': {
      handleRun(event, api)
      // Runtime map is authoritative for multi-session chrome/composer — always key by event session.
      const sessionKey = eventSessionFile(event) || api.get().historySessionFile
      if (sessionKey && (event.phase === 'running' || event.phase === 'started')) {
        useUIStore.getState().setSessionRuntimeRunning(sessionKey, true)
      } else if (sessionKey && event.phase === 'idle') {
        const after = api.get()
        if (after.runState.status === 'idle') {
          useUIStore.getState().setSessionRuntimeRunning(sessionKey, false)
        }
      } else if (sessionKey && (event.phase === 'failed' || event.phase === 'cancelled')) {
        useUIStore.getState().setSessionRuntimeRunning(sessionKey, false)
      }
      break
    }
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