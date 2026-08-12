import { captureVisibleLiveSessionTimeline } from '@renderer/lib/capture-live-session-timeline'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { useUIStore } from '@renderer/stores/ui-store'

export type BlankSessionKind = 'pending-project' | 'ephemeral-sandbox'

function clearBlankSessionProjection(): void {
  captureVisibleLiveSessionTimeline()

  const state = useUIStore.getState()
  state.clearTimeline()
  useUIStore.setState({
    pendingSteering: [],
    pendingFollowUp: [],
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    fileChanges: [],
    historyTotalCount: 0,
    historyLoadedCount: 0,
    historySessionFile: null,
    historyLoading: false,
    subagentSessionGroup: null,
    workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
    runState: {
      ...state.runState,
      status: 'idle',
      activeRunId: undefined,
      activeTool: undefined,
      activeToolStatus: undefined,
      toolCount: 0,
      errorCount: 0,
    },
  })
  useExtensionUIStore.getState().resetForSessionContext()
}

export function resetBlankSessionProjection(): void {
  clearBlankSessionProjection()
}

export function enterBlankSession(kind: BlankSessionKind): void {
  clearBlankSessionProjection()
  useUIStore.setState({
    ephemeralSandboxDraft: kind === 'ephemeral-sandbox',
    pendingNewSessionPlaceholder: kind === 'pending-project',
    ...(kind === 'ephemeral-sandbox' ? { currentWorkspace: null } : {}),
    currentSessionId: kind === 'ephemeral-sandbox' ? '__ephemeral_draft__' : '__pending_new__',
  })

  if (kind === 'ephemeral-sandbox') {
    void ipcClient.invoke('session.setEphemeralDraft', { active: true }).catch(() => {})
  } else {
    void ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }
}
