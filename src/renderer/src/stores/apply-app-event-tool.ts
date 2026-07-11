import { extractStatusFromOutput } from '@extension-compat/json-path'
import { toolCallDetailFromPi } from '@shared/tool-call-detail'
import { resolveToolCardDef } from '@renderer/features/timeline/tool-card-registry'
import type { StoreApi, ToolEvent } from '@renderer/stores/apply-app-event-types'

/** Live tool update/end: match by toolCallId only (no name fallback — parallel same-name tools). */
export function findLiveToolRowByCallId(
  items: Array<{ type?: string; toolCallId?: string; id?: string; toolArgs?: unknown }>,
  toolCallId: string | undefined,
): { type?: string; toolCallId?: string; id?: string; toolArgs?: unknown } | undefined {
  if (!toolCallId) return undefined
  return [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === toolCallId)
}

export function handleTool(event: ToolEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'start') {
    // First tool ends optimistic "waiting" chrome (same as first assistant token).
    if (api.get().agentTurnBootstrapping) {
      api.set({ agentTurnBootstrapping: false })
    }
    const toolItem = {
      id: api.nextItemId(),
      type: 'tool-call' as const,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolPhase: 'start' as const,
      toolArgs: event.input,
      runId: event.runId,
      timestamp: event.timestamp,
    }
    const streamId = state.streamingAssistantId
    if (streamId) {
      const streamRow = state.timelineItems.find((i) => i.id === streamId)
      const proseEmpty = !streamRow?.text?.trim() && !streamRow?.thinkingText?.trim()
      if (proseEmpty) {
        // Empty optimistic assistant: insert tool before it, then drop the empty bubble.
        state.insertTimelineBefore(streamId, toolItem)
        if (streamRow?.id.startsWith('opt-asst-')) {
          api.set({
            streamingAssistantId: null,
            timelineItems: api.get().timelineItems.filter((row) => row.id !== streamId),
          })
        }
      } else {
        api.set({ streamingAssistantId: null })
        state.appendTimeline(toolItem)
      }
    } else {
      state.appendTimeline(toolItem)
    }
    state.setRunState({ activeTool: event.toolName })
    return
  }
  if (event.phase === 'update') {
    const items = api.get().timelineItems
    const lastTool = findLiveToolRowByCallId(items, event.toolCallId)
    const line = extractStatusFromOutput(event.output, resolveToolCardDef(event.toolName)?.statusField)
    if (lastTool?.id && line) state.updateTimelineItem(lastTool.id, { toolPhase: 'update', toolStatusLine: line })
    if (line) state.setRunState({ activeTool: event.toolName, activeToolStatus: line })
    return
  }
  if (event.phase === 'end') {
    const items = api.get().timelineItems
    const lastTool = findLiveToolRowByCallId(items, event.toolCallId)
    let outText = ''
    const raw = event.output
    if (typeof raw === 'string') outText = raw
    else if (raw && typeof raw === 'object' && 'content' in raw && Array.isArray((raw as { content: unknown[] }).content)) {
      outText = (raw as { content: { text?: string }[] }).content.map((c) => c?.text || '').join('')
    } else if (raw != null) outText = JSON.stringify(raw, null, 2)
    if (lastTool?.id) {
      const toolDetail = toolCallDetailFromPi(event.toolName, lastTool.toolArgs, outText)
      state.updateTimelineItem(lastTool.id, {
        toolPhase: 'end',
        toolOutput: outText,
        toolDetails: event.details,
        toolDetail,
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
