import { normalizeTimelineMessageText } from '@renderer/lib/timeline-dedupe'
import type { MessageEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleMessage(event: MessageEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'start' && event.role === 'user') {
    if (state.runState.status !== 'running') {
      state.setRunState({ status: 'running', startTime: event.timestamp })
    }
    const opt = state.optimisticPendingUserText
    const incoming = normalizeTimelineMessageText(event.text)
    if (opt || incoming) {
      const items = api.get().timelineItems
      const lastUser = [...items].reverse().find((i) => i.type === 'user-message')
      const lastNorm = lastUser ? normalizeTimelineMessageText(lastUser.text) : ''
      const optNorm = opt ? normalizeTimelineMessageText(opt) : ''
      const matchesOpt =
        !!lastUser && (lastUser.id.startsWith('opt-user-') || (optNorm && lastNorm === optNorm))
      const matchesIncoming = !!lastUser && incoming && lastNorm === incoming
      if (matchesOpt || matchesIncoming) {
        if (event.text?.trim()) {
          state.updateTimelineItem(lastUser!.id, {
            text: event.text,
            segments: undefined,
            ...(event.sessionEntryId ? { sessionEntryId: event.sessionEntryId } : {}),
          })
        } else if (event.sessionEntryId) {
          state.updateTimelineItem(lastUser!.id, { sessionEntryId: event.sessionEntryId })
        }
        api.set({ optimisticPendingUserText: null })
        return
      }
      if (opt) api.set({ optimisticPendingUserText: null })
    }
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'user-message',
      text: event.text,
      timestamp: event.timestamp,
      sessionEntryId: event.sessionEntryId,
    })
    return
  }
  if (event.phase === 'end' && event.role === 'user' && event.sessionEntryId) {
    const items = api.get().timelineItems
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'user-message' && !items[i].sessionEntryId) {
        state.updateTimelineItem(items[i].id, { sessionEntryId: event.sessionEntryId })
        api.set({ optimisticPendingUserText: null })
        break
      }
    }
    return
  }
  if (event.role !== 'assistant') return
  // Clear bootstrap flag once; repeated no-op sets cause extra selector work on every delta.
  const clearAgentTurnBootstrappingIfNeeded = () => {
    if (api.get().agentTurnBootstrapping) {
      api.set({ agentTurnBootstrapping: false })
    }
  }
  if (event.phase === 'start') {
    clearAgentTurnBootstrappingIfNeeded()
    const items = api.get().timelineItems
    const sid = api.get().streamingAssistantId
    const last = items[items.length - 1]
    if (last?.type === 'assistant-message' && sid === last.id) return
    const emptyOpt = [...items]
      .reverse()
      .find(
        (i) =>
          i.type === 'assistant-message' &&
          i.id.startsWith('opt-asst-') &&
          !i.text?.trim() &&
          !i.thinkingText?.trim(),
      )
    if (emptyOpt) {
      api.set({ streamingAssistantId: emptyOpt.id })
      return
    }
    const id = api.nextItemId()
    state.appendTimeline({
      id,
      type: 'assistant-message',
      text: '',
      thinkingText: '',
      runId: event.runId,
      timestamp: event.timestamp,
    })
    api.set({ streamingAssistantId: id })
  } else if (event.phase === 'delta' && event.text) {
    clearAgentTurnBootstrappingIfNeeded()
    if (!api.get().streamingAssistantId) {
      const id = api.nextItemId()
      state.appendTimeline({
        id,
        type: 'assistant-message',
        text: '',
        thinkingText: '',
        runId: event.runId,
        timestamp: event.timestamp,
      })
      api.set({ streamingAssistantId: id })
    }
    // Route thinking vs prose by contentKind only — never put body into thinking.
    if (event.contentKind === 'thinking') state.appendThinkingDelta(event.text)
    else state.appendDeltaToStreamingAssistant(event.text)
  } else if (event.phase === 'end') {
    clearAgentTurnBootstrappingIfNeeded()
    const sid = api.get().streamingAssistantId
    const hasFinalText = event.text !== undefined && String(event.text).trim().length > 0
    if (hasFinalText) {
      // Final text is always assistant prose, never thinking.
      if (event.contentKind === 'thinking') state.appendThinkingDelta(String(event.text))
      else state.setStreamingAssistantFinalText(event.text ?? '')
    } else if (!api.get().agentTurnBootstrapping && !api.get().optimisticPendingUserText) {
      api.set({ streamingAssistantId: null })
    }
    if (sid && event.sessionEntryId) {
      state.updateTimelineItem(sid, { sessionEntryId: event.sessionEntryId })
    }
    if (!api.get().agentTurnBootstrapping) state.pruneEmptyAssistantBubbles()
  }
}