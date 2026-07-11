/**
 * Mark the current streaming assistant as incomplete with a stop reason.
 * Display-only: does not change agent execution.
 */
export function markStreamingAssistantIncomplete(
  getState: () => {
    streamingAssistantId: string | null
    timelineItems: Array<{ id: string; type: string }>
    updateTimelineItem: (id: string, patch: { incomplete?: boolean; stopReason?: string }) => void
  },
  stopReason: string,
): void {
  const state = getState()
  const streamId = state.streamingAssistantId
  if (streamId) {
    state.updateTimelineItem(streamId, { incomplete: true, stopReason })
    return
  }
  // Fallback: last open assistant without terminal stopReason
  for (let index = state.timelineItems.length - 1; index >= 0; index--) {
    const row = state.timelineItems[index]
    if (row.type === 'user-message') break
    if (row.type === 'assistant-message') {
      state.updateTimelineItem(row.id, { incomplete: true, stopReason })
      return
    }
  }
}
