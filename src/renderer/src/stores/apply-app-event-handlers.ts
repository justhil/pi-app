import { extractStatusFromOutput } from '@extension-compat/json-path'
import { resolveToolCardDef } from '@renderer/features/timeline/tool-card-registry'
import { signalDesktopAlert } from '@renderer/lib/desktop-alerts'
import { alertTrace } from '@renderer/lib/alert-trace'
import { normalizeTimelineMessageText } from '@renderer/lib/timeline-dedupe'
import { agentErrorKind, formatAgentErrorForTimeline } from '@renderer/lib/agent-error-text'
import type { UIState } from '@renderer/stores/ui-store-types'
import type {
  AgentErrorEvent,
  CompactionEvent,
  MessageEvent,
  RunEvent,
  SlashEvent,
  StoreApi,
  ToolEvent,
} from '@renderer/stores/apply-app-event-types'

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
  if (event.phase === 'start') {
    api.set({ agentTurnBootstrapping: false })
    const items = api.get().timelineItems
    const sid = api.get().streamingAssistantId
    const last = items[items.length - 1]
    if (last?.type === 'assistant-message' && sid === last.id) return
    const emptyOpt = [...items]
      .reverse()
      .find((i) => i.type === 'assistant-message' && i.id.startsWith('opt-asst-') && !i.text?.trim())
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
    api.set({ agentTurnBootstrapping: false })
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
    if (event.contentKind === 'thinking') state.appendThinkingDelta(event.text)
    else state.appendDeltaToStreamingAssistant(event.text)
  } else if (event.phase === 'end') {
    const sid = api.get().streamingAssistantId
    const hasFinalText = event.text !== undefined && String(event.text).trim().length > 0
    if (hasFinalText) state.setStreamingAssistantFinalText(event.text ?? '')
    else if (!api.get().agentTurnBootstrapping && !api.get().optimisticPendingUserText) {
      api.set({ streamingAssistantId: null })
    }
    if (sid && event.sessionEntryId) {
      state.updateTimelineItem(sid, { sessionEntryId: event.sessionEntryId })
    }
    if (!api.get().agentTurnBootstrapping) state.pruneEmptyAssistantBubbles()
  }
}

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

export function handleRun(event: RunEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'started' || event.phase === 'running') {
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

export function handleCompaction(event: CompactionEvent, api: StoreApi): void {
  const state = api.get()
  if (event.phase === 'start') {
    void Promise.all([
      import('@renderer/lib/extension-ui-channel'),
      import('@renderer/stores/extension-ui-store'),
    ]).then(([ch, st]) => {
      ch.clearExtensionDialogDedupe()
      st.useExtensionUIStore.getState().clearAfterRespond()
    })
  } else if (event.phase === 'end') {
    state.appendTimeline({
      id: api.nextItemId(),
      type: 'compaction',
      text: event.summary,
      timestamp: event.timestamp,
    })
  }
}

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