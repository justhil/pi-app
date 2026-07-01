import { extractStatusFromOutput } from '@extension-compat/json-path'
import { resolveToolCardDef } from '@renderer/features/timeline/tool-card-registry'
import type { StoreApi, ToolEvent } from '@renderer/stores/apply-app-event-types'

export function handleTool(event: ToolEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'start') {
    if (state.streamingAssistantId) api.set({ streamingAssistantId: null })
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'tool-call',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolPhase: 'start',
      toolArgs: event.input,
      runId: event.runId,
      timestamp: event.timestamp,
    })
    state.setRunState({ activeTool: event.toolName })
    return
  }
  if (event.phase === 'update') {
    const items = api.get().timelineItems
    const lastTool =
      [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId) ||
      [...items]
        .reverse()
        .find(
          (i) =>
            i.type === 'tool-call' &&
            i.toolName === event.toolName &&
            (i.toolPhase === 'start' || i.toolPhase === 'update'),
        )
    const line = extractStatusFromOutput(event.output, resolveToolCardDef(event.toolName)?.statusField)
    if (lastTool && line) state.updateTimelineItem(lastTool.id, { toolPhase: 'update', toolStatusLine: line })
    if (line) state.setRunState({ activeTool: event.toolName, activeToolStatus: line })
    return
  }
  if (event.phase === 'end') {
    const items = api.get().timelineItems
    const lastTool =
      [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === event.toolCallId) ||
      [...items]
        .reverse()
        .find(
          (i) =>
            i.type === 'tool-call' &&
            i.toolName === event.toolName &&
            (i.toolPhase === 'start' || i.toolPhase === 'update'),
        )
    let outText = ''
    const raw = event.output
    if (typeof raw === 'string') outText = raw
    else if (raw && typeof raw === 'object' && 'content' in raw && Array.isArray((raw as { content: unknown[] }).content)) {
      outText = (raw as { content: { text?: string }[] }).content.map((c) => c?.text || '').join('')
    } else if (raw != null) outText = JSON.stringify(raw, null, 2)
    if (lastTool) {
      state.updateTimelineItem(lastTool.id, {
        toolPhase: 'end',
        toolOutput: outText,
        toolDetails: event.details,
        toolStatusLine: undefined,
        extensionUiSuspended: false,
        extensionUiRequestId: undefined,
        isError: event.isError,
      })
    }
    const rs = api.get().runState
    state.setRunState({
      toolCount: rs.toolCount + 1,
      activeTool: undefined,
      activeToolStatus: undefined,
      errorCount: rs.errorCount + (event.isError ? 1 : 0),
    })
  }
}