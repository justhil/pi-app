import type { SessionScopedAppEvent } from '@shared/app-event-session'

export type AppEventRoute = 'visible' | 'background' | 'drop'

type RouteState = {
  currentWorkspace: string | null
  currentSessionId: string | null
  historySessionFile: string | null
  workerLiveSnapshot: { sessionId: string | null; sessionFile: string | null }
}

export function resolveAppEventRoute(state: RouteState, event: SessionScopedAppEvent): AppEventRoute {
  const evWs = event.workspaceId
  const viewWs = state.currentWorkspace
  if (evWs && viewWs && evWs !== viewWs) {
    if (event.sessionFile) return 'background'
    return 'drop'
  }

  const viewFile = state.historySessionFile
  const workerFile = state.workerLiveSnapshot.sessionFile
  const evFile = event.sessionFile
  const viewSid = state.currentSessionId
  const workerSid = state.workerLiveSnapshot.sessionId
  const evSid = event.sessionId

  if (evFile) {
    if (viewFile && evFile === viewFile) return 'visible'
    if (viewFile && evFile !== viewFile) {
      if (workerFile && evFile === workerFile) return 'background'
      return 'drop'
    }
    // viewFile 为空：Worker 绑定的事件视为可见，避免发送瞬间丢首 token
    if (workerFile && evFile === workerFile) return 'visible'
  }

  const backgroundBySid = !!evSid && !!viewSid && !!workerSid && evSid === workerSid && evSid !== viewSid
  if (backgroundBySid) return 'background'
  if (evSid && viewSid && evSid !== viewSid) return 'drop'
  return 'visible'
}