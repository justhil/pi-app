import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import {
  extractTextFromPiMessage,
  piUsageTotals,
  type PiCompactionEndResult,
  type PiSessionMessage,
} from '@shared/worker-message'
import { resolveInteractByTool } from '../extension-compat/adapter-loader.js'
import { extractJsonPath } from '../extension-compat/json-path.js'
import type { DesktopUIBridge } from './desktop-ui-bridge.js'
import { emitAgentErrorFromAssistant, lastAssistantFromMessages } from './session-event-helpers.js'

export type SessionEventDeps = {
  baseEvent: () => Record<string, unknown>
  emit: (event: AppEvent) => void
  getSession: () => AgentSession | null
  getSessionModelKey: () => string | undefined
  getUiBridge: () => DesktopUIBridge | null
  isAgentTurnActive: () => boolean
  setAgentTurnActive: (v: boolean) => void
  setCurrentRunId: (id: string) => void
  setCurrentTurnId: (id: string) => void
  nextSeq: () => number
}

export function handleSessionEvent(event: AgentSessionEvent, deps: SessionEventDeps): void {
  const base = deps.baseEvent()
  const session = deps.getSession()
  const uiBridge = deps.getUiBridge()

  switch (event.type) {
    case 'agent_start': {
      deps.setAgentTurnActive(true)
      deps.setCurrentRunId(`run-${deps.nextSeq()}`)
      deps.setCurrentTurnId(`turn-${deps.nextSeq()}`)
      deps.emit({ ...base, type: 'run', phase: 'running' } as AppEvent)
      break
    }
    case 'agent_end': {
      if (!deps.isAgentTurnActive()) {
        if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_AUDIO_TRACE === 'true') {
          console.log('[audio-trace] worker.agent_end_ignored', { agentTurnActive: false })
        }
        break
      }
      deps.setAgentTurnActive(false)
      const willRetry = !!(event as { willRetry?: boolean }).willRetry
      if (!willRetry) {
        const last = lastAssistantFromMessages((event as { messages?: unknown[] }).messages || [])
        if (last && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
          deps.emit({ ...base, type: 'run', phase: 'failed' } as AppEvent)
        }
      }
      if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_AUDIO_TRACE === 'true') {
        console.log('[audio-trace] worker.emit_run_idle')
      }
      deps.emit({ ...base, type: 'run', phase: 'idle' } as AppEvent)
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
        deps.emit({ ...base, type: 'message', role: 'assistant', phase: 'start' } as AppEvent)
      }
      break
    }
    case 'message_update': {
      const ame = event.assistantMessageEvent as
        | { type?: string; delta?: string; content?: string; text?: string }
        | undefined
      const chunk =
        typeof ame?.delta === 'string'
          ? ame.delta
          : typeof ame?.content === 'string'
            ? ame.content
            : typeof ame?.text === 'string'
              ? ame.text
              : ''
      if (!chunk) break
      if (ame?.type === 'thinking_delta') {
        deps.emit({
          ...base,
          type: 'message',
          role: 'assistant',
          phase: 'delta',
          text: chunk,
          contentKind: 'thinking',
        } as AppEvent)
      } else if (ame?.type === 'text_delta') {
        deps.emit({
          ...base,
          type: 'message',
          role: 'assistant',
          phase: 'delta',
          text: chunk,
          contentKind: 'text',
        } as AppEvent)
      }
      break
    }
    case 'message_end': {
      const msg = event.message as PiSessionMessage
      const entryId = session?.sessionManager?.getLeafId?.() ?? undefined
      if (msg?.role === 'assistant') {
        const text = extractTextFromPiMessage(msg)
        deps.emit({
          ...base,
          type: 'message',
          role: 'assistant',
          phase: 'end',
          text,
          sessionEntryId: entryId,
        } as AppEvent)
        emitAgentErrorFromAssistant(base, msg, deps.emit)
      } else if (msg?.role === 'user') {
        deps.emit({ ...base, type: 'message', role: 'user', phase: 'end', sessionEntryId: entryId } as AppEvent)
      }
      break
    }
    case 'tool_execution_start': {
      if (uiBridge && event.args) {
        const interact = resolveInteractByTool(event.toolName)
        if (interact) {
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
      deps.emit({
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'update',
        output: event.partialResult,
      } as AppEvent)
      break
    }
    case 'tool_execution_end': {
      const endResult = event.result as { details?: unknown }
      deps.emit({
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'end',
        output: endResult,
        details: endResult?.details,
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
      process.parentPort?.postMessage({ type: 'extension-ui-dismiss-all', reason: 'compaction' })
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
        steering: [...(event.steering || [])],
        followUp: [...(event.followUp || [])],
      } as AppEvent)
      break
    }
    case 'auto_retry_end': {
      const e = event as { success?: boolean; finalError?: string; attempt?: number }
      if (!e.success && e.finalError) {
        const raw = e.finalError
        deps.emit({
          ...base,
          type: 'agent_error',
          text: e.attempt ? `Aborted after ${e.attempt} retry attempt\n${raw}` : String(raw),
          kind: 'retry',
          stopReason: 'error',
        } as AppEvent)
        deps.emit({ ...base, type: 'run', phase: 'failed' } as AppEvent)
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