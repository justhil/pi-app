import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { isViewingWorkerBoundSession } from '@renderer/lib/session-worker-sync'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import { alertTrace } from '@renderer/lib/alert-trace'
import type { RunEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

/**
 * Whether a run.idle should be ignored as "too early" (race before agent_start).
 *
 * pi-tui treats AgentSession completion as authoritative (`agent_end` without willRetry /
 * `!isStreaming`). Renderer must not block idle forever on empty optimistic assistant
 * placeholders (tool-only turns leave empty `opt-asst-*` rows).
 *
 * Only suppress idle while we still have *local* outbound bootstrap and the worker has
 * never attached a real run id for this turn.
 */
export function shouldSuppressPrematureRunIdle(state: {
  optimisticPendingUserText: string | null
  agentTurnBootstrapping: boolean
  runState: { activeRunId?: string; status: string }
}): boolean {
  const waitingOnLocalSend =
    state.optimisticPendingUserText != null || state.agentTurnBootstrapping === true
  if (!waitingOnLocalSend) return false
  // Worker already started a real agent turn → idle is completion, not a race.
  if (state.runState.activeRunId) return false
  return true
}

function markViewIdle(state: ReturnType<StoreApi['get']>): void {
  const viewFile = state.historySessionFile
  const liveSnap = state.workerLiveSnapshot
  if (!liveSnap.sessionFile || !viewFile || liveSnap.sessionFile === viewFile) {
    state.setWorkerLiveSnapshot({
      sessionId: state.currentSessionId ?? liveSnap.sessionId,
      sessionFile: viewFile ?? liveSnap.sessionFile,
      status: 'idle',
    })
  }
}

export function handleRun(event: RunEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'started' || event.phase === 'running') {
    if (isAbortUiHoldActive()) return
    if (Date.now() < state.ignoreQueueSyncUntil && event.phase === 'running') return

    // Visible-route handler: still refuse to apply if event names a different session
    // (route bugs / unscoped events must not re-light the viewed session).
    const viewFile = state.historySessionFile
    const evFile = (event as { sessionFile?: string }).sessionFile
    if (viewFile && evFile && !isViewingWorkerBoundSession(viewFile, evFile)) {
      return
    }

    const runPatch: Record<string, unknown> = {
      status: 'running',
      activeRunId: event.runId,
      startTime: event.timestamp,
    }
    if (event.model != null && String(event.model).trim()) runPatch.model = event.model
    if (event.thinkingLevel != null && String(event.thinkingLevel).trim()) {
      runPatch.thinkingLevel = event.thinkingLevel
    }
    state.setRunState(runPatch)
    const snap = state.workerLiveSnapshot
    if (viewFile) {
      // Always pin worker snap to the *viewed* session when we accept a visible run.
      state.setWorkerLiveSnapshot({
        sessionId: state.currentSessionId ?? snap.sessionId,
        sessionFile: viewFile,
        status: 'running',
      })
    }
    return
  }
  if (event.phase === 'idle') {
    alertTrace('run event idle', {
      runId: event.runId,
      statusBefore: state.runState.status,
      startTime: state.runState.startTime,
    })
    const s = api.get()
    if (shouldSuppressPrematureRunIdle(s)) {
      alertTrace('run idle suppressed (local outbound not yet bound to worker run)', {
        optimistic: !!s.optimisticPendingUserText,
        bootstrapping: s.agentTurnBootstrapping,
      })
      return
    }
    // Authoritative completion (pi agent_end / !isStreaming): clear all local turn markers.
    api.set({
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      streamingAssistantId: null,
    })
    const rs = api.get().runState
    const wasActive = rs.status === 'running' || rs.status === 'failed'
    const prevRun = rs.activeRunId
    const durationMs = rs.startTime ? Math.max(0, Date.now() - rs.startTime) : rs.lastRunDurationMs
    state.setRunState({
      status: 'idle',
      lastRunId: prevRun ?? rs.lastRunId,
      lastRunDurationMs: durationMs,
      activeRunId: undefined,
      activeTool: undefined,
      activeToolStatus: undefined,
    })
    markViewIdle(state)
    state.clearPendingQueue()
    state.pruneEmptyAssistantBubbles()
    void import('@renderer/lib/extension-ui-tool-sync').then((m) => m.reconcileAllStaleInteractiveToolRows())
    if (wasActive && rs.startTime && durationMs != null && durationMs >= 800) {
      const sec = Math.round(durationMs / 1000)
      alertTrace('run_idle alert fired', { durationMs, sec })
      void signalDesktopAlert('run_idle', {
        title: 'pi Desktop · 运行结束',
        body: sec > 0 ? `Agent 已空闲（约 ${sec} 秒）` : 'Agent 已空闲，可继续输入',
      })
    }
    return
  }
  if (event.phase === 'failed') {
    state.setRunState({ status: 'failed' })
    const viewFile = state.historySessionFile
    const liveSnap = state.workerLiveSnapshot
    if (!liveSnap.sessionFile || !viewFile || liveSnap.sessionFile === viewFile) {
      state.setWorkerLiveSnapshot({
        sessionId: state.currentSessionId ?? liveSnap.sessionId,
        sessionFile: viewFile ?? liveSnap.sessionFile,
        status: 'failed',
      })
    }
  } else if (event.phase === 'state') {
    const patch: Record<string, string | undefined> = {}
    if (event.model !== undefined) patch.model = event.model
    if (event.thinkingLevel !== undefined) patch.thinkingLevel = event.thinkingLevel
    state.setRunState(patch)
  }
  if (event.usage) state.setRunState({ usage: event.usage })
  if (event.toolStats) {
    state.setRunState({ toolCount: event.toolStats.total, errorCount: event.toolStats.failed })
  }
}
