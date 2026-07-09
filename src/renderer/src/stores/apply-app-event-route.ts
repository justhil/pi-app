import type { SessionScopedAppEvent } from '@shared/app-event-session'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'

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
    if (viewFile && sessionFilesEqual(evFile, viewFile)) return 'visible'
    if (viewFile && !sessionFilesEqual(evFile, viewFile)) {
      // Multi-session: any other session's events go to background cache (E1), not drop.
      return 'background'
    }
    // viewFile 为空：Worker 绑定的事件视为可见，避免发送瞬间丢首 token
    if (workerFile && sessionFilesEqual(evFile, workerFile)) return 'visible'
    if (evFile) return 'background'
  }

  const backgroundBySid = !!evSid && !!viewSid && !!workerSid && evSid === workerSid && evSid !== viewSid
  if (backgroundBySid) return 'background'
  // Different sessionId while viewing another session: still cache for multi-session runtime
  if (evSid && viewSid && evSid !== viewSid) return 'background'

  // No sessionFile on event: only treat as visible when it matches the view worker snap.
  // Defaulting to 'visible' caused A's unscoped run events to re-light B after switch.
  if (viewFile && workerFile && !sessionFilesEqual(viewFile, workerFile)) {
    return 'background'
  }
  if (viewFile && !workerFile && evSid && viewSid && evSid !== viewSid) {
    return 'background'
  }
  return 'visible'
}
