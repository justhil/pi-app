import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import { assistantStreamDeltaFromMessageUpdate } from '@shared/pi-message-update'
import { takeStreamUpdate } from '@shared/stream-merge'
import {
  extractTextFromPiMessage,
  normalizeUserMessageDisplayText,
  piUsageTotals,
  type PiCompactionEndResult,
  type PiSessionMessage,
} from '@shared/worker-message'
import { resolveInteractByTool } from '../extension-compat/adapter-loader.js'
import { extractJsonPath, extractStatusFromOutput } from '../extension-compat/json-path.js'
import { enrichToolChildSessionFiles } from '../extension-compat/tool-child-session.js'
import type { DesktopUIBridge } from './desktop-ui-bridge.js'
import { lastAssistantFromMessages } from './session-event-helpers.js'
import { sendToMain } from './worker-transport.js'

export type SessionEventDeps = {
  baseEvent: () => Record<string, unknown>
  emit: (event: AppEvent) => void
  getSession: () => AgentSession | null
  getSessionModelKey: () => string | undefined
  getUiBridge: () => DesktopUIBridge | null
  isAgentTurnActive: () => boolean
  setAgentTurnActive: (v: boolean) => void
  setPromptPreflightActive: (value: boolean) => void
  setCurrentRunId: (id: string) => void
  setCurrentTurnId: (id: string) => void
  nextSeq: () => number
}

type PendingTerminalError = {
  text: string
  kind: 'error' | 'aborted' | 'retry'
  stopReason: string
}

let assistantTextSnapshot = ''
let assistantThinkingSnapshot = ''
let pendingTerminalError: PendingTerminalError | null = null

export function resetSessionEventTracking(): void {
  assistantTextSnapshot = ''
  assistantThinkingSnapshot = ''
  pendingTerminalError = null
}

function terminalErrorFromAssistant(
  message: PiSessionMessage | null | undefined,
): PendingTerminalError | null {
  if (!message || (message.stopReason !== 'error' && message.stopReason !== 'aborted')) return null
  const aborted = message.stopReason === 'aborted'
  return {
    text: String(message.errorMessage || (aborted ? 'Request was aborted.' : 'Agent request failed.')),
    kind: aborted ? 'aborted' : 'error',
    stopReason: message.stopReason,
  }
}

function emitSettledRun(deps: SessionEventDeps): void {
  const terminalError = pendingTerminalError
  const base = deps.baseEvent()
  deps.setAgentTurnActive(false)
  deps.setPromptPreflightActive(false)
  pendingTerminalError = null
  assistantTextSnapshot = ''
  assistantThinkingSnapshot = ''

  queueMicrotask(() => {
    if (terminalError) {
      deps.emit({
        ...base,
        type: 'agent_error',
        text: terminalError.text,
        kind: terminalError.kind,
        stopReason: terminalError.stopReason,
      } as AppEvent)
    }
    const phase = terminalError
      ? terminalError.kind === 'aborted'
        ? 'cancelled'
        : 'failed'
      : 'idle'
    deps.emit({ ...base, type: 'run', phase, settled: true } as AppEvent)
  })
}

export function handleSessionEvent(event: AgentSessionEvent, deps: SessionEventDeps): void {
  const base = deps.baseEvent()
  const session = deps.getSession()
  const uiBridge = deps.getUiBridge()

  switch (event.type) {
    case 'agent_start': {
      const hadProvisionalRun = deps.isAgentTurnActive()
      deps.setAgentTurnActive(true)
      deps.setPromptPreflightActive(false)
      if (!hadProvisionalRun) {
        deps.setCurrentRunId(`run-${deps.nextSeq()}`)
        deps.setCurrentTurnId(`turn-${deps.nextSeq()}`)
      }
      resetSessionEventTracking()
      deps.emit({ ...deps.baseEvent(), type: 'run', phase: 'running' } as AppEvent)
      break
    }
    case 'agent_end': {
      const willRetry = event.willRetry
      const lastAssistant = lastAssistantFromMessages(event.messages || [])
      if (willRetry) {
        pendingTerminalError = null
        break
      }
      pendingTerminalError = terminalErrorFromAssistant(lastAssistant)
      break
    }
    case 'agent_settled': {
      emitSettledRun(deps)
      break
    }
    case 'turn_start': {
      deps.setCurrentTurnId(`turn-${deps.nextSeq()}`)
      break
    }
    case 'turn_end': {
      const msg = event.message as PiSessionMessage
      const totals = piUsageTotals(msg?.usage)
      if (totals) {
        deps.emit({ ...base, type: 'run', phase: 'running', usage: totals } as AppEvent)
      }
      break
    }
    case 'message_start': {
      const msg = event.message as PiSessionMessage
      if (msg?.role === 'assistant') {
        assistantTextSnapshot = ''
        assistantThinkingSnapshot = ''
        deps.emit({ ...base, type: 'message', role: 'assistant', phase: 'start' } as AppEvent)
      } else if (msg?.role === 'user') {
        deps.emit({
          ...base,
          type: 'message',
          role: 'user',
          phase: 'start',
          text: normalizeUserMessageDisplayText(extractTextFromPiMessage(msg)),
        } as AppEvent)
      }
      break
    }
    case 'message_update': {
      const msg = event.message as PiSessionMessage
      const ame = event.assistantMessageEvent as
        | { type?: string; delta?: string; content?: string; text?: string }
        | undefined
      const stream = assistantStreamDeltaFromMessageUpdate(msg, ame)
      if (stream.text && stream.textSource) {
        const nextText = takeStreamUpdate(assistantTextSnapshot, stream.text, stream.textSource)
        assistantTextSnapshot = nextText.cumulative
        if (nextText.chunk) {
          deps.emit({
            ...base,
            type: 'message',
            role: 'assistant',
            phase: 'delta',
            text: nextText.chunk,
            contentKind: 'text',
          } as AppEvent)
        }
      }
      if (stream.thinking && stream.thinkingSource) {
        const nextThinking = takeStreamUpdate(
          assistantThinkingSnapshot,
          stream.thinking,
          stream.thinkingSource,
        )
        assistantThinkingSnapshot = nextThinking.cumulative
        if (nextThinking.chunk) {
          deps.emit({
            ...base,
            type: 'message',
            role: 'assistant',
            phase: 'delta',
            text: nextThinking.chunk,
            contentKind: 'thinking',
          } as AppEvent)
        }
      }
      break
    }
    case 'message_end': {
      const msg = event.message as PiSessionMessage
      if (msg?.role === 'assistant') pendingTerminalError = terminalErrorFromAssistant(msg)
      const text = msg?.role === 'assistant' ? extractTextFromPiMessage(msg) : undefined
      queueMicrotask(() => {
        const entryId = session?.sessionManager?.getLeafId?.() ?? undefined
        if (msg?.role === 'assistant') {
          deps.emit({
            ...base,
            type: 'message',
            role: 'assistant',
            phase: 'end',
            text,
            sessionEntryId: entryId,
          } as AppEvent)
        } else if (msg?.role === 'user') {
          deps.emit({
            ...base,
            type: 'message',
            role: 'user',
            phase: 'end',
            sessionEntryId: entryId,
          } as AppEvent)
        }
      })
      assistantTextSnapshot = ''
      assistantThinkingSnapshot = ''
      break
    }
    case 'tool_execution_start': {
      if (uiBridge && event.args) {
        const interact = resolveInteractByTool(event.toolName)
        if (interact && interact.schema !== 'questions') {
          const extracted: Record<string, unknown> = {}
          for (const [field, path] of Object.entries(interact.fields || {})) {
            extracted[field] = extractJsonPath(event.args, path)
          }
          uiBridge.setInteractArgs(interact.schema, extracted)
        }
      }
      deps.emit({
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'start',
        input: event.args,
      } as AppEvent)
      break
    }
    case 'tool_execution_update': {
      const statusLine = extractStatusFromOutput(event.partialResult)
      const partialResult = event.partialResult as { details?: unknown } | null | undefined
      const parentSessionFile = typeof base.sessionFile === 'string' ? base.sessionFile : undefined
      const details = enrichToolChildSessionFiles(
        event.toolName,
        parentSessionFile,
        partialResult?.details,
      )
      if (statusLine || details !== undefined) {
        deps.emit({
          ...base,
          type: 'tool',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          phase: 'update',
          output: statusLine ?? undefined,
          details,
        } as AppEvent)
      }
      break
    }
    case 'tool_execution_end': {
      const endResult = event.result as { details?: unknown }
      const parentSessionFile = typeof base.sessionFile === 'string' ? base.sessionFile : undefined
      const details = enrichToolChildSessionFiles(
        event.toolName,
        parentSessionFile,
        endResult?.details,
      )
      deps.emit({
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'end',
        output: endResult,
        details,
        isError: event.isError,
      } as AppEvent)
      if (event.toolName === 'edit' || event.toolName === 'write') {
        const args = (event as { args?: { path?: string } }).args
        if (args?.path) {
          deps.emit({
            ...base,
            type: 'file',
            source: event.toolName,
            path: args.path,
            changeType: event.toolName === 'write' ? 'added' : 'modified',
          } as AppEvent)
        }
      }
      break
    }
    case 'compaction_start': {
      deps.emit({ ...base, type: 'compaction', phase: 'start' } as AppEvent)
      sendToMain({ type: 'extension-ui-dismiss-all', reason: 'compaction' })
      break
    }
    case 'session_info_changed':
    case 'thinking_level_changed': {
      if (session) {
        deps.emit({
          ...base,
          type: 'run',
          phase: 'state',
          model: deps.getSessionModelKey(),
          thinkingLevel: session.thinkingLevel,
        } as AppEvent)
      }
      break
    }
    case 'queue_update': {
      deps.emit({
        ...base,
        type: 'queue',
        steering: (event.steering || []).map(normalizeUserMessageDisplayText),
        followUp: (event.followUp || []).map(normalizeUserMessageDisplayText),
      } as AppEvent)
      break
    }
    case 'auto_retry_end': {
      const e = event as { success?: boolean; finalError?: string; attempt?: number }
      if (!e.success && e.finalError) {
        pendingTerminalError = {
          text: e.attempt
            ? `Aborted after ${e.attempt} retry attempt\n${e.finalError}`
            : String(e.finalError),
          kind: 'retry',
          stopReason: 'error',
        }
      }
      break
    }
    case 'compaction_end': {
      const e = event as { errorMessage?: string; aborted?: boolean }
      if (e.errorMessage && !e.aborted) {
        deps.emit({
          ...base,
          type: 'agent_error',
          text: String(e.errorMessage),
          kind: 'error',
          stopReason: 'error',
        } as AppEvent)
      }
      {
        const cr = (event as { result?: PiCompactionEndResult }).result
        deps.emit({
          ...base,
          type: 'compaction',
          phase: 'end',
          tokensSaved: cr?.tokensBefore,
          summary: cr?.summary,
        } as AppEvent)
      }
      break
    }
  }
}
