// Pi Worker - runs pi SDK in a utilityProcess
// This file is the entry point spawned by Electron utilityProcess

import {
  createAgentSession,
  createAgentSessionRuntime,
  type AgentSession,
  type AgentSessionRuntime,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'

let session: AgentSession | null = null
let runtime: AgentSessionRuntime | null = null
let seq = 0
let currentWorkspaceId = ''
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

async function initSession(cwd: string): Promise<void> {
  // Clean up existing session
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  session = null
  runtime = null

  currentWorkspaceId = cwd

  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)
  const sessionManager = SessionManager.create(cwd)

  const createRuntime = async ({ cwd: rtCwd, sessionManager: rtSm, sessionStartEvent }: any) => {
    const { createAgentSessionServices, createAgentSessionFromServices } = await import(
      '@earendil-works/pi-coding-agent'
    )
    const services = await createAgentSessionServices({ cwd: rtCwd })
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager: rtSm,
        sessionStartEvent,
      })),
      services,
      diagnostics: services.diagnostics,
    }
  }

  runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: undefined, // use default ~/.pi/agent
    sessionManager,
  })

  session = runtime.session
  currentSessionId = session.sessionId

  // Subscribe to events and convert to AppEvent
  unsubscribe = session.subscribe((event: any) => {
    const base = {
      seq: nextSeq(),
      workspaceId: currentWorkspaceId,
      sessionId: currentSessionId,
      runId: currentRunId,
      turnId: currentTurnId,
      timestamp: now(),
    }

    switch (event.type) {
      case 'message_update':
        if (event.assistantMessageEvent?.type === 'text_delta') {
          emit({ ...base, type: 'message', role: 'assistant', phase: 'delta', text: event.assistantMessageEvent.delta })
        }
        break
      case 'message_start':
        emit({ ...base, type: 'message', role: 'assistant', phase: 'start' })
        break
      case 'message_end':
        emit({ ...base, type: 'message', role: 'assistant', phase: 'end' })
        break
      case 'tool_execution_start':
        emit({
          ...base,
          type: 'tool',
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          phase: 'start',
          input: event.input,
        })
        break
      case 'tool_execution_update':
        emit({
          ...base,
          type: 'tool',
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          phase: 'update',
          output: event.output,
        })
        break
      case 'tool_execution_end':
        emit({
          ...base,
          type: 'tool',
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          phase: 'end',
          output: event.result,
          isError: event.isError,
        })
        // Track file changes from edit/write
        if (event.toolName === 'edit' || event.toolName === 'write') {
          const input = event.input as any
          if (input?.path) {
            emit({ ...base, type: 'file', source: event.toolName, path: input.path, changeType: 'modified' })
          }
        }
        break
      case 'agent_start':
        currentRunId = `run-${nextSeq()}`
        currentTurnId = `turn-${nextSeq()}`
        emit({ ...base, type: 'run', phase: 'started' })
        break
      case 'agent_end':
        emit({ ...base, type: 'run', phase: 'idle' })
        break
      case 'turn_start':
        currentTurnId = `turn-${nextSeq()}`
        break
      case 'turn_end':
        if (event.message?.usage) {
          const u = event.message.usage
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
      case 'compaction_start':
        emit({ ...base, type: 'compaction', phase: 'start' })
        break
      case 'compaction_end':
        emit({
          ...base,
          type: 'compaction',
          phase: 'end',
          tokensSaved: event.result?.tokensSaved,
          summary: event.result?.summary,
        })
        break
    }
  })

  emit({ seq: nextSeq(), workspaceId: currentWorkspaceId, sessionId: currentSessionId, type: 'run', phase: 'idle', timestamp: now() })
}

// Message handler from Main process
process.parentPort?.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'init': {
        await initSession(msg.cwd)
        process.parentPort?.postMessage({ type: 'init-done', sessionId: currentSessionId })
        break
      }
      case 'prompt': {
        if (!session) {
          process.parentPort?.postMessage({ type: 'error', error: 'No session' })
          break
        }
        currentRunId = `run-${nextSeq()}`
        currentTurnId = `turn-${nextSeq()}`
        emit({ seq: nextSeq(), workspaceId: currentWorkspaceId, sessionId: currentSessionId, runId: currentRunId, turnId: currentTurnId, type: 'run', phase: 'running', timestamp: now() })

        // Emit user message
        emit({ seq: nextSeq(), workspaceId: currentWorkspaceId, sessionId: currentSessionId, runId: currentRunId, turnId: currentTurnId, type: 'message', role: 'user', phase: 'start', text: msg.text, timestamp: now() })
        emit({ seq: nextSeq(), workspaceId: currentWorkspaceId, sessionId: currentSessionId, runId: currentRunId, turnId: currentTurnId, type: 'message', role: 'user', phase: 'end', timestamp: now() })

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
        // Model setting via dynamic import - will be resolved at runtime
        // The pi-ai package is available as a dependency of pi-coding-agent
        try {
          const piAi = require('@earendil-works/pi-ai')
          const model = piAi.getModel?.(msg.provider, msg.modelId)
          if (model && session) {
            await session.setModel(model)
          }
        } catch (e) {
          console.error('Failed to set model:', e)
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
        await runtime?.newSession()
        session = runtime?.session ?? null
        currentSessionId = session?.sessionId ?? ''
        if (session) {
          unsubscribe?.()
          unsubscribe = session.subscribe(() => {}) // re-subscribe will be handled by re-init
        }
        process.parentPort?.postMessage({ type: 'newSession-done', sessionId: currentSessionId })
        break
      }
      case 'dispose': {
        unsubscribe?.()
        session?.dispose()
        await runtime?.dispose()
        process.parentPort?.postMessage({ type: 'dispose-done' })
        break
      }
      case 'ping': {
        process.parentPort?.postMessage({ type: 'pong' })
        break
      }
    }
  } catch (error) {
    process.parentPort?.postMessage({ type: 'error', error: String(error) })
  }
})
