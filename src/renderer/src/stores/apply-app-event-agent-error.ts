import { agentErrorKind, formatAgentErrorForTimeline } from '@renderer/lib/agent-error-text'
import type { UIState } from '@renderer/stores/ui-store-types'
import type { AgentErrorEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleAgentError(event: AgentErrorEvent, api: StoreApi): void {
  const state = api.get()
  api.set({ optimisticPendingUserText: null, agentTurnBootstrapping: false, streamingAssistantId: null })
  state.pruneEmptyAssistantBubbles()
  const raw = event.text || '未知错误'
  const kind = event.kind || agentErrorKind(raw)
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
  if (last?.type === 'error' && last.text === formatted) return
  state.appendTimeline({
    id: api.nextItemId(),
    type: 'error',
    text: formatted,
    errorKind: kind,
    timestamp: event.timestamp,
  })
  state.setRunState({ status: kind === 'aborted' ? 'idle' : 'failed' })
}