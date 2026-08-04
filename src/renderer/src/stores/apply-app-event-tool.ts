import { extractStatusFromOutput, extractTextFromToolOutput } from '@extension-compat/json-path'
import { toolCallDetailFromPi } from '@shared/tool-call-detail'
import { resolveToolCardDef } from '@renderer/features/timeline/tool-card-registry'
import type { StoreApi, ToolEvent } from '@renderer/stores/apply-app-event-types'
import { flushStreamPendingSync } from '@renderer/stores/ui-store-stream'

/** Live tool update/end: match by toolCallId only (no name fallback — parallel same-name tools). */
export function findLiveToolRowByCallId(
  items: Array<{ type?: string; toolCallId?: string; id?: string; toolArgs?: unknown }>,
  toolCallId: string | undefined,
): { type?: string; toolCallId?: string; id?: string; toolArgs?: unknown } | undefined {
  if (!toolCallId) return undefined
  return [...items].reverse().find((i) => i.type === 'tool-call' && i.toolCallId === toolCallId)
}

export function handleTool(event: ToolEvent, api: StoreApi): void {
  if (event.phase === 'start') {
    flushStreamPendingSync(api.get, api.set)
    const state = api.get()
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
      turnId: event.turnId,
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
  const state = api.get()
  if (event.phase === 'update') {
    const items = state.timelineItems
    const lastTool = findLiveToolRowByCallId(items, event.toolCallId)
    const line = extractStatusFromOutput(event.output, resolveToolCardDef(event.toolName)?.statusField)
    if (lastTool?.id && (line || event.details !== undefined)) {
      state.updateTimelineItem(lastTool.id, {
        toolPhase: 'update',
        ...(line ? { toolStatusLine: line } : {}),
        ...(event.details !== undefined ? { toolDetails: event.details } : {}),
        runId: event.runId,
        turnId: event.turnId,
      })
    }
    if (line) state.setRunState({ activeTool: event.toolName, activeToolStatus: line })
    return
  }
  if (event.phase === 'end') {
    const items = api.get().timelineItems
    const lastTool = findLiveToolRowByCallId(items, event.toolCallId)
    const readableOutput = extractTextFromToolOutput(event.output)
    const outText = readableOutput || (event.output == null ? '' : JSON.stringify(event.output, null, 2))
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
        runId: event.runId,
        turnId: event.turnId,
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
