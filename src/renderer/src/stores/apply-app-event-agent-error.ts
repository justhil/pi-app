import { agentErrorKind, formatAgentErrorForTimeline } from '@renderer/lib/agent-error-text'
import i18n from '@renderer/lib/i18n'
import { markStreamingAssistantIncomplete } from '@renderer/lib/mark-streaming-incomplete'
import type { UIState } from '@renderer/stores/ui-store-types'
import type { AgentErrorEvent, StoreApi } from '@renderer/stores/apply-app-event-types'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

function settleOpenToolRows(api: StoreApi): void {
  const items = api.get().timelineItems
  if (
    !Array.isArray(items) ||
    !items.some((row) => row.type === 'tool-call' && (row.toolPhase === 'start' || row.toolPhase === 'update'))
  ) {
    return
  }
  api.set({
    timelineItems: items.map((row) =>
      row.type === 'tool-call' && (row.toolPhase === 'start' || row.toolPhase === 'update')
        ? { ...row, toolPhase: 'end', toolStatusLine: undefined }
        : row,
    ),
  })
}

export function handleAgentError(event: AgentErrorEvent, api: StoreApi): void {
  flushStreamPendingSync(api.get, api.set)
  const raw = event.text || i18n.t('common:agentError.unknown')
  const kind = event.kind || agentErrorKind(raw)
  const stopReason = kind === 'aborted' ? 'aborted' : kind === 'retry' ? 'error' : 'error'
  // Mark incomplete before clearing stream id / pruning empty bubbles.
  markStreamingAssistantIncomplete(() => api.get(), stopReason)
  if (kind !== 'retry') settleOpenToolRows(api)
  api.set({ optimisticPendingUserText: null, agentTurnBootstrapping: false, streamingAssistantId: null })
  const state = api.get()
  // Do not prune incomplete assistants — keep them for rewind / interrupted UI.
  const formatted = formatAgentErrorForTimeline(raw)
  const items = state.timelineItems
  const recentAbort = items
    .slice(-6)
    .filter((i: UIState['timelineItems'][number]) => i.type === 'error' && i.errorKind === 'aborted' && i.text === formatted)
  if (kind === 'aborted' && recentAbort.length >= 1) {
    state.setRunState({ status: 'idle', activeRunId: undefined, activeTool: undefined, activeToolStatus: undefined })
    return
  }
  const last = items[items.length - 1]
  if (last?.type === 'error' && last.text === formatted) {
    state.setRunState({ status: kind === 'aborted' ? 'idle' : 'failed' })
    return
  }
  state.appendTimeline({
    id: api.nextItemId(),
    type: 'error',
    text: formatted,
    errorKind: kind,
    timestamp: event.timestamp,
  })
  state.setRunState({ status: kind === 'aborted' ? 'idle' : 'failed' })
}
