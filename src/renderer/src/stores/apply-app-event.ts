import type { AppEvent } from '@shared/app-events'
import { isSessionScopedAppEvent } from '@shared/app-event-session'
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
import { applyBackgroundAppEvent, eventSessionFile } from '@renderer/stores/apply-app-event-background'
import { applyExtensionWidgetEvent, getSessionComposerWidget } from '@renderer/lib/extension-widget-cache'
import { markLiveSessionTurnEnded } from '@renderer/lib/live-session-timeline-cache'
import { isAbortQueueIgnoreActive, shouldIgnoreAppEventAfterAbort } from '@renderer/lib/abort-ui-hold'
import { reduceSubagentSessionGroupToolEvent } from '@renderer/lib/subagent-session-activity'
import { useTurnDiffStore } from '@renderer/stores/turn-diff-store'
import type { StoreApi } from '@renderer/stores/apply-app-event-types'

export type { StoreApi } from '@renderer/stores/apply-app-event-types'

export function applyAppEvent(event: AppEvent, api: StoreApi): void {
  if (!isSessionScopedAppEvent(event)) return
  if (shouldIgnoreAppEventAfterAbort(event)) return
  // 回合文件净 diff：与可见性无关，直接入进程内缓存（可见/后台会话都能结算）
  if (event.type === 'turn_diff') {
    useTurnDiffStore.getState().addRecord({
      sessionFile: eventSessionFile(event) || '',
      turnId: event.turnId,
      runId: event.runId,
      turnOrdinal: event.turnOrdinal,
      files: event.files,
      updatedAt: event.timestamp,
    })
    return
  }
  const state = api.get()
  if (event.type === 'tool' && state.subagentSessionGroup) {
    const nextGroup = reduceSubagentSessionGroupToolEvent(state.subagentSessionGroup, event)
    if (nextGroup !== state.subagentSessionGroup) {
      state.setSubagentSessionGroup(nextGroup)
    }
  }
  const route = resolveAppEventRoute(state, event)
  if (route === 'drop') return
  if (route === 'background') {
    applyBackgroundAppEvent(event)
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
      const accepted = handleRun(event, api)
      const sessionKey = eventSessionFile(event) || api.get().historySessionFile
      if (accepted && sessionKey && (event.phase === 'running' || event.phase === 'started')) {
        useUIStore.getState().setSessionRuntimeRunning(sessionKey, true)
      } else if (sessionKey && event.phase === 'idle') {
        if (api.get().runState.status === 'idle') {
          useUIStore.getState().setSessionRuntimeRunning(sessionKey, false)
          markLiveSessionTurnEnded(sessionKey, 'idle')
        }
      } else if (sessionKey && (event.phase === 'failed' || event.phase === 'cancelled')) {
        useUIStore.getState().setSessionRuntimeRunning(sessionKey, false)
        markLiveSessionTurnEnded(sessionKey, event.phase === 'failed' ? 'failed' : 'idle')
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
      if (isAbortQueueIgnoreActive(eventSessionFile(event) || state.historySessionFile)) {
        const hasQueued = (event.steering?.length ?? 0) > 0 || (event.followUp?.length ?? 0) > 0
        if (hasQueued) break
      }
      state.setPendingQueue(event.steering, event.followUp)
      break
    case 'agent_error': {
      handleAgentError(event, api)
      const sessionKey = eventSessionFile(event) || api.get().historySessionFile
      if (sessionKey) {
        markLiveSessionTurnEnded(sessionKey, event.kind === 'aborted' ? 'idle' : 'failed')
      }
      break
    }
    case 'completion':
      break
    case 'extension_widget': {
      applyExtensionWidgetEvent(event)
      const viewFile = api.get().historySessionFile
      if (viewFile) api.get().setComposerWidget(getSessionComposerWidget(viewFile))
      break
    }
  }
}
