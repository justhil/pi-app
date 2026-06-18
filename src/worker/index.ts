// Pi Worker - runs pi SDK in a utilityProcess via MessagePort
// Entry point spawned by Electron utilityProcess as ESM (.mjs)

import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'

let session: AgentSession | null = null
let seq = 0
let currentCwd = ''
let currentSessionId = ''
let currentRunId = ''
let currentTurnId = ''
let unsubscribe: (() => void) | null = null

function nextSeq(): number {
  return ++seq
}

function emit(event: AppEvent): void {
  process.parentPort?.postMessage({ type: 'app-event', event })
}

function now(): number {
  return Date.now()
}

function baseEvent() {
  return {
    seq: nextSeq(),
    workspaceId: currentCwd,
    sessionId: currentSessionId,
    runId: currentRunId,
    turnId: currentTurnId,
    timestamp: now(),
  }
}

async function initSession(cwd: string): Promise<void> {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (session) {
    session.dispose()
    session = null
  }

  currentCwd = cwd

  const { session: newSession, modelFallbackMessage } = await createAgentSession({ cwd })

  session = newSession
  currentSessionId = session.sessionId

  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event)
  })

  emit({ ...baseEvent(), type: 'run', phase: 'idle' })

  if (modelFallbackMessage) {
    console.warn('[Worker] Model fallback:', modelFallbackMessage)
  }
}

function handleSessionEvent(event: AgentSessionEvent): void {
  const base = baseEvent()

  switch (event.type) {
    case 'agent_start': {
      currentRunId = `run-${nextSeq()}`
      currentTurnId = `turn-${nextSeq()}`
      emit({ ...base, type: 'run', phase: 'running' })
      break
    }
    case 'agent_end': {
      emit({ ...base, type: 'run', phase: 'idle' })
      break
    }
    case 'turn_start': {
      currentTurnId = `turn-${nextSeq()}`
      break
    }
    case 'turn_end': {
      const msg = event.message as any
      if (msg?.usage) {
        const u = msg.usage
        emit({
          ...base,
          type: 'run',
          phase: 'running',
          usage: {
            input: u.input || 0,
            output: u.output || 0,
            cacheRead: u.cacheRead || 0,
            cacheWrite: u.cacheWrite || 0,
            cost: u.cost?.total || 0,
          },
        })
      }
      break
    }
    case 'message_start': {
      const msg = event.message as any
      if (msg?.role === 'assistant') {
        emit({ ...base, type: 'message', role: 'assistant', phase: 'start' })
      }
      break
    }
    case 'message_update': {
      const ame = event.assistantMessageEvent
      if (ame?.type === 'text_delta') {
        emit({ ...base, type: 'message', role: 'assistant', phase: 'delta', text: ame.delta })
      }
      break
    }
    case 'message_end': {
      const msg = event.message as any
      if (msg?.role === 'assistant') {
        emit({ ...base, type: 'message', role: 'assistant', phase: 'end' })
      }
      break
    }
    case 'tool_execution_start': {
      emit({ ...base, type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, phase: 'start', input: event.args })
      break
    }
    case 'tool_execution_update': {
      emit({ ...base, type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, phase: 'update', output: event.partialResult })
      break
    }
    case 'tool_execution_end': {
      emit({ ...base, type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, phase: 'end', output: event.result, isError: event.isError })
      if (event.toolName === 'edit' || event.toolName === 'write') {
        const args = event.args as any
        if (args?.path) {
          emit({ ...base, type: 'file', source: event.toolName, path: args.path, changeType: event.toolName === 'write' ? 'added' : 'modified' })
        }
      }
      break
    }
    case 'compaction_start': {
      emit({ ...base, type: 'compaction', phase: 'start' })
      break
    }
    case 'compaction_end': {
      emit({ ...base, type: 'compaction', phase: 'end', tokensSaved: event.result?.tokensBefore, summary: event.result?.summary })
      break
    }
  }
}

async function listSessions(cwd: string): Promise<any[]> {
  try {
    return await SessionManager.list(cwd)
  } catch (e) {
    console.error('[Worker] listSessions failed:', e)
    return []
  }
}

// In utilityProcess, parentPort messages come as MessageEvent with data property
process.parentPort?.on('message', async (event: any) => {
  // Handle both direct message and MessageEvent
  const msg = event?.data ?? event
  console.log('[Worker] Received:', msg?.type)

  try {
    switch (msg.type) {
      case 'init': {
        try {
          console.log('[Worker] Initializing session for:', msg.cwd)
          await initSession(msg.cwd)
          console.log('[Worker] Init done, sessionId:', currentSessionId)
          process.parentPort?.postMessage({ type: 'init-done', sessionId: currentSessionId, model: session?.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined, thinkingLevel: session?.thinkingLevel })
        } catch (e: any) {
          console.error('[Worker] Init FAILED:', e.message, e.stack)
          process.parentPort?.postMessage({ type: 'error', error: `Init failed: ${e.message}`, stack: e.stack })
        }
        break
      }
      case 'prompt': {
        if (!session) { process.parentPort?.postMessage({ type: 'error', error: 'No session' }); break }
        emit({ ...baseEvent(), type: 'message', role: 'user', phase: 'start', text: msg.text })
        emit({ ...baseEvent(), type: 'message', role: 'user', phase: 'end' })
        await session.prompt(msg.text, msg.options)
        process.parentPort?.postMessage({ type: 'prompt-done' })
        break
      }
      case 'abort': {
        await session?.abort()
        process.parentPort?.postMessage({ type: 'abort-done' })
        break
      }
      case 'steer': {
        await session?.steer(msg.text)
        process.parentPort?.postMessage({ type: 'steer-done' })
        break
      }
      case 'followUp': {
        await session?.followUp(msg.text)
        process.parentPort?.postMessage({ type: 'followUp-done' })
        break
      }
      case 'setModel': {
        if (session) {
          try {
            const { getModel } = await import('@earendil-works/pi-ai')
            const model = getModel(msg.provider, msg.modelId)
            if (model) await session.setModel(model)
          } catch (e) { console.error('[Worker] setModel failed:', e) }
        }
        process.parentPort?.postMessage({ type: 'setModel-done' })
        break
      }
      case 'setThinkingLevel': {
        session?.setThinkingLevel(msg.level)
        process.parentPort?.postMessage({ type: 'setThinkingLevel-done' })
        break
      }
      case 'newSession': {
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
        if (session) { session.dispose(); session = null }
        const { session: newSession } = await createAgentSession({ cwd: currentCwd })
        session = newSession
        currentSessionId = session.sessionId
        unsubscribe = session.subscribe((event: AgentSessionEvent) => handleSessionEvent(event))
        process.parentPort?.postMessage({ type: 'newSession-done', sessionId: currentSessionId })
        break
      }
      case 'listSessions': {
        const sessions = await listSessions(msg.cwd || currentCwd)
        process.parentPort?.postMessage({ type: 'listSessions-done', sessions })
        break
      }
      case 'getState': {
        if (session) {
          process.parentPort?.postMessage({
            type: 'getState-done',
            state: {
              sessionId: session.sessionId,
              sessionName: session.sessionName,
              model: session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined,
              thinkingLevel: session.thinkingLevel,
              isStreaming: session.isStreaming,
              sessionFile: session.sessionFile,
              messageCount: session.messages.length,
            },
          })
        }
        break
      }
      case 'dispose': {
        unsubscribe?.()
        session?.dispose()
        session = null
        process.parentPort?.postMessage({ type: 'dispose-done' })
        break
      }
      case 'ping': {
        process.parentPort?.postMessage({ type: 'pong' })
        break
      }
    }
  } catch (error) {
    process.parentPort?.postMessage({ type: 'error', error: String(error), stack: (error as Error)?.stack })
  }
})

console.log('[Worker] Ready')
