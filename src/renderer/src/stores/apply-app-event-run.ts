import { isAbortUiHoldActive } from '@renderer/lib/abort-ui-hold'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import { alertTrace } from '@renderer/lib/alert-trace'
import type { UIState } from '@renderer/stores/ui-store-types'
import type { RunEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleRun(event: RunEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'started' || event.phase === 'running') {
    if (isAbortUiHoldActive()) return
    if (Date.now() < state.ignoreQueueSyncUntil && event.phase === 'running') return
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
    return
  }
  if (event.phase === 'idle') {
    alertTrace('run event idle', {
      runId: event.runId,
      statusBefore: state.runState.status,
      startTime: state.runState.startTime,
    })
    const s = api.get()
    const pendingOutboundTurn =
      s.optimisticPendingUserText != null ||
      s.agentTurnBootstrapping ||
      s.timelineItems.some(
        (i: UIState['timelineItems'][number]) =>
          i.type === 'assistant-message' &&
          i.id.startsWith('opt-asst-') &&
          !i.text?.trim() &&
          !i.thinkingText?.trim(),
      )
    if (pendingOutboundTurn) return
    api.set({ optimisticPendingUserText: null, agentTurnBootstrapping: false })
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
    state.clearPendingQueue()
    api.set({ streamingAssistantId: null })
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