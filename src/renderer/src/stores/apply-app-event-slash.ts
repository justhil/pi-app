import type { UIState } from '@renderer/stores/ui-store-types'
import type { SlashEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleSlash(event: SlashEvent, api: StoreApi): void {
  const state = api.get()
  const items = state.timelineItems
  const pendingIdx = [...items].reverse().findIndex(
    (i) => i.type === 'slash' && i.slashCommand === event.command && i.slashStatus === 'dispatched',
  )
  if (pendingIdx >= 0 && event.status !== 'dispatched') {
    const idx = items.length - 1 - pendingIdx
    state.updateTimelineItem(items[idx].id, {
      slashStatus: event.status,
      text: event.text,
      isError: event.status === 'error',
      timestamp: event.timestamp,
    })
    if (event.status === 'ok' || event.status === 'error') {
      api.set({ agentTurnBootstrapping: false, optimisticPendingUserText: null })
      state.pruneEmptyAssistantBubbles()
      if (api.get().runState.status === 'running' && !api.get().streamingAssistantId) {
        const hasOpenTool = api.get().timelineItems.some(
          (i: UIState['timelineItems'][number]) => i.type === 'tool-call' && (i.toolPhase === 'start' || i.toolPhase === 'update'),
        )
        if (!hasOpenTool) {
          state.setRunState({ status: 'idle', activeTool: undefined, activeToolStatus: undefined })
        }
      }
    }
    return
  }
  if (event.status === 'dispatched') {
    const last = items[items.length - 1]
    if (last?.type === 'slash' && last.slashCommand === event.command && last.slashStatus === 'dispatched') {
      return
    }
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'slash',
      slashCommand: event.command,
      slashStatus: event.status,
      text: event.text,
      isError: false,
      timestamp: event.timestamp,
    })
    return
  }
  state.appendTimeline({
    id: api.nextItemId(),
    type: 'slash',
    slashCommand: event.command,
    slashStatus: event.status,
    text: event.text,
    isError: event.status === 'error',
    timestamp: event.timestamp,
  })
}