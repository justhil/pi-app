// Pi Worker - runs pi SDK in a utilityProcess via MessagePort
// Entry point spawned by Electron utilityProcess as ESM (.mjs)

import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import { createDesktopUIBridge, type DesktopUIBridge, type ExtensionUIResponse } from './desktop-ui-bridge.js'
import { resolveInteractByTool } from '../extension-compat/adapter-loader.js'

/** Extract a value from an object via a simple JSONPath ("$.field" or "$.a.b"). */
function extractJsonPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = path.replace(/^\$\.?/, '').split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

let session: AgentSession | null = null
let uiBridge: DesktopUIBridge | null = null
let sharedEventBus = createEventBus()
let seq = 0
let currentCwd = ''
let currentSessionId = ''
let currentRunId = ''
let currentTurnId = ''
let unsubscribe: (() => void) | null = null

// Safety net: some extensions (e.g. pi-powerline-footer) keep timers running on a
// captured ctx that becomes stale after session replacement; the SDK throws but
// it is harmless to the desktop pipeline. We cannot patch the plugin, so swallow
// this specific class of error to keep the Worker process alive.
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err)
  if (msg.includes('stale') && (msg.includes('extension ctx') || msg.includes('ExtensionRunner'))) {
    console.warn('[Worker] swallowed stale extension ctx error:', msg)
    return
  }
  console.error('[Worker] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  const msg = (reason as any)?.message || String(reason)
  if (msg.includes('stale') && msg.includes('extension ctx')) return
  console.error('[Worker] unhandledRejection:', reason)
})

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

  const agentDir = getAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: sharedEventBus,
  })
  await resourceLoader.reload()

  const { session: newSession, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader,
  })

  session = newSession
  currentSessionId = session.sessionId
  await bindDesktopExtensions(session)

  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event)
  })

  emit({ ...baseEvent(), type: 'run', phase: 'idle' })
  if (session) {
    const modelStr = session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined
    emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
  }

  if (modelFallbackMessage) {
    console.warn('[Worker] Model fallback:', modelFallbackMessage)
  }
}

async function bindDesktopExtensions(sess: AgentSession): Promise<void> {
  if (!uiBridge) {
    uiBridge = createDesktopUIBridge(sharedEventBus, (req) => {
      process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
    })
  }
  await sess.bindExtensions({
    uiContext: uiBridge.uiContext as never,
    mode: 'rpc',
  })
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
        const text = extractText(msg)
        emit({ ...base, type: 'message', role: 'assistant', phase: 'end', text })
      }
      break
    }
    case 'tool_execution_start': {
      // Generic interact caching: if any adapter declares interact.trigger.tool for this toolName,
      // extract args per interact.fields and cache for the bridge custom() call.
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
      emit({ ...base, type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, phase: 'start', input: event.args })
      break
    }
    case 'tool_execution_update': {
      emit({ ...base, type: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, phase: 'update', output: event.partialResult })
      break
    }
    case 'tool_execution_end': {
      const endResult = event.result as any
      emit({
        ...base,
        type: 'tool',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'end',
        output: endResult,
        details: endResult?.details,
        isError: event.isError,
      })
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
    case 'session_info_changed':
    case 'thinking_level_changed': {
      // Push current model + thinking level to renderer for live status bar update
      if (session) {
        const modelStr = session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined
        emit({ ...base, type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
      }
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

// Normalize pi AgentMessage[] into timeline items for the desktop renderer
let msgSeq = 0
function normalizeMessages(messages: any[]): any[] {
  const items: any[] = []
  const now = Date.now()
  // Map toolCallId → item index for precise toolResult attachment
  const toolCallIndex = new Map<string, number>()

  for (const m of messages) {
    const ts = (m as any).timestamp ? new Date((m as any).timestamp).getTime() : now
    const content = m.content || []

    if (m.role === 'user') {
      const text = extractText(m)
      if (text) items.push({ id: `hist-${++msgSeq}`, type: 'user-message', text, timestamp: ts })
    } else if (m.role === 'assistant') {
      const text = extractText(m)
      const toolCalls = content.filter((c: any) => c.type === 'toolCall')
      if (text) {
        items.push({ id: `hist-${++msgSeq}`, type: 'assistant-message', text, timestamp: ts })
      }
      for (const c of toolCalls) {
        const name = c.toolCall?.name || 'tool'
        const input = c.toolCall?.input || c.toolCall?.arguments
        const callId = c.toolCall?.id || ''
        const item: any = {
          id: `hist-${++msgSeq}`,
          type: 'tool-call',
          toolName: name,
          toolArgs: input || undefined,
          toolPhase: 'end',
          toolOutput: '',
          timestamp: ts,
        }
        const idx = items.length
        items.push(item)
        if (callId) toolCallIndex.set(callId, idx)
      }
    } else if (m.role === 'toolResult') {
      // toolResult has toolCallId + toolName; attach output to the matching tool-call card.
      const text = extractText(m)
      const callId = m.toolCallId || ''
      const toolName = m.toolName || ''
      // Try precise match by toolCallId first
      let targetIdx = callId ? toolCallIndex.get(callId) : undefined
      // Fallback: most recent tool-call with matching name and empty output
      if (targetIdx === undefined) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].type === 'tool-call' && !items[i].toolOutput && (!toolName || items[i].toolName === toolName)) {
            targetIdx = i; break
          }
        }
      }
      if (targetIdx !== undefined && items[targetIdx]) {
        items[targetIdx].toolOutput = text.slice(0, 4000)
        if (toolName && items[targetIdx].toolName === 'tool') items[targetIdx].toolName = toolName
      } else if (text) {
        items.push({
          id: `hist-${++msgSeq}`,
          type: 'tool-call',
          toolName: toolName || 'result',
          toolPhase: 'end',
          toolOutput: text.slice(0, 2000),
          timestamp: ts,
        })
      }
    } else if (m.role === 'compactionSummary' || m.role === 'branchSummary') {
      const text = extractText(m)
      items.push({ id: `hist-${++msgSeq}`, type: 'compaction', text, timestamp: ts })
    }
  }
  return items
}

function extractText(message: any): string {
  if (!message?.content) return typeof message === 'string' ? message : ''
  if (typeof message.content === 'string') return message.content
  return (message.content as any[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('')
}

function extractToolResult(message: any): string {
  if (!message?.content) return ''
  const parts = (message.content as any[])
    .filter((c) => c.type === 'toolResult')
    .map((c) => {
      if (typeof c.content === 'string') return c.content
      if (Array.isArray(c.content)) return c.content.map((x: any) => x.text || '').join('')
      return ''
    })
  return parts.join('\n')
}

// In utilityProcess, parentPort messages come as MessageEvent with data property
process.parentPort?.on('message', async (event: any) => {
  // Handle both direct message and MessageEvent
  const msg = event?.data ?? event
  console.log('[Worker] Received:', msg?.type)
  // Helper: reply preserves requestId so manager can resolve the pending promise
  const reply = (payload: any) => {
    process.parentPort?.postMessage({ requestId: msg?.requestId, ...payload })
  }

  try {
    switch (msg.type) {
      case 'init': {
        try {
          console.log('[Worker] Initializing session for:', msg.cwd)
          await initSession(msg.cwd)
          console.log('[Worker] Init done, sessionId:', currentSessionId)
          reply({ type: 'init-done', sessionId: currentSessionId, model: session?.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined, thinkingLevel: session?.thinkingLevel })
        } catch (e: any) {
          console.error('[Worker] Init FAILED:', e.message, e.stack)
          reply({ type: 'error', error: `Init failed: ${e.message}`, stack: e.stack })
        }
        break
      }
      case 'prompt': {
        if (!session) { reply({ type: 'error', error: 'No session' }); break }
        // B-layer slash observability (R0-1): if the prompt is a slash command, emit a slash event
        const slashMatch = typeof msg.text === 'string' ? msg.text.match(/^(\/\S+)/) : null
        if (slashMatch) {
          emit({
            ...baseEvent(),
            type: 'slash',
            command: slashMatch[1],
            status: 'dispatched',
            text: '已发送给 pi 执行',
          })
        }
        emit({ ...baseEvent(), type: 'message', role: 'user', phase: 'start', text: msg.text })
        emit({ ...baseEvent(), type: 'message', role: 'user', phase: 'end' })
        try {
          await session.prompt(msg.text, msg.options)
          if (slashMatch) {
            emit({
              ...baseEvent(),
              type: 'slash',
              command: slashMatch[1],
              status: 'ok',
              text: '命令已执行（详见下方助手/工具输出）',
            })
          }
          reply({ type: 'prompt-done' })
        } catch (e: any) {
          if (slashMatch) {
            emit({
              ...baseEvent(),
              type: 'slash',
              command: slashMatch[1],
              status: 'error',
              text: `执行失败: ${e?.message || String(e)}`,
            })
          }
          reply({ type: 'error', error: `Prompt failed: ${e?.message || String(e)}` })
        }
        break
      }
      case 'abort': {
        await session?.abort()
        reply({ type: 'abort-done' })
        break
      }
      case 'steer': {
        await session?.steer(msg.text)
        reply({ type: 'steer-done' })
        break
      }
      case 'followUp': {
        await session?.followUp(msg.text)
        reply({ type: 'followUp-done' })
        break
      }
      case 'setModel': {
        if (session) {
          try {
            // Resolve model from the session's modelRegistry (no dynamic pi-ai import — it's a nested dep not hoisted).
            const model = (session.modelRegistry as any)?.find?.(msg.provider, msg.modelId)
              ?? (session.modelRegistry as any)?.get?.(msg.provider, msg.modelId)
            if (model) await session.setModel(model)
            const modelStr = session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined
            emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
          } catch (e) { console.error('[Worker] setModel failed:', e) }
        }
        reply({ type: 'setModel-done' })
        break
      }
      case 'setThinkingLevel': {
        session?.setThinkingLevel(msg.level)
        if (session) {
          const modelStr = session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
        }
        reply({ type: 'setThinkingLevel-done' })
        break
      }
      case 'newSession': {
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
        if (session) { session.dispose(); session = null }
        await initSession(currentCwd)
        reply({ type: 'newSession-done', sessionId: currentSessionId })
        break
      }
      case 'listSessions': {
        const sessions = await listSessions(msg.cwd || currentCwd)
        reply({ type: 'listSessions-done', sessions })
        break
      }
      case 'getModels': {
        try {
          const models = session
            ? await session.modelRegistry.getAvailable()
            : []
          reply({
            type: 'getModels-done',
            models: models.map((m: any) => ({
              id: m.id,
              name: m.name || m.id,
              provider: m.provider,
              contextWindow: m.contextWindow || 0,
              maxOutput: m.maxOutput || 0,
              available: true,
            })),
          })
        } catch (e: any) {
          reply({ type: 'error', error: `getModels failed: ${e.message}` })
        }
        break
      }
      case 'getCommands': {
        // Authoritative command list from the live AgentSession (per docs/tui-replacement-and-adapters.md §2.2)
        const commands: any[] = []
        const withSlash = (n: string) => n.startsWith('/') ? n : `/${n}`
        if (session) {
          try {
            for (const cmd of session.extensionRunner.getRegisteredCommands()) {
              commands.push({
                id: cmd.invocationName,
                name: withSlash(cmd.invocationName),
                description: cmd.description || '',
                category: 'extension',
                source: cmd.sourceInfo as any,
              })
            }
          } catch (e) { console.error('[Worker] getRegisteredCommands failed:', e) }
          try {
            for (const tpl of session.promptTemplates) {
              commands.push({
                id: tpl.name,
                name: withSlash(tpl.name),
                description: tpl.description || '',
                category: 'prompt',
                source: tpl.sourceInfo as any,
              })
            }
          } catch (e) { console.error('[Worker] promptTemplates failed:', e) }
          try {
            const skills = (session.resourceLoader as any).getSkills?.()
            for (const sk of skills?.skills || []) {
              const sname = sk.name?.startsWith('skill:') ? sk.name : `skill:${sk.name}`
              commands.push({
                id: sk.name,
                name: withSlash(sname),
                description: sk.description || '',
                category: 'skill',
                source: sk.sourceInfo as any,
              })
            }
          } catch (e) { console.error('[Worker] getSkills failed:', e) }
        }
        reply({ type: 'getCommands-done', commands, hasSession: !!session })
        break
      }
      case 'getSessionContextPreview': {
        try {
          const lines: string[] = []
          let msgCount = 0
          let estChars = 0
          if (session) {
            for (const m of session.messages || []) {
              msgCount++
              const t = extractText(m)
              estChars += t.length
              if (lines.length < 12 && t) {
                const role = (m as any).role || '?'
                lines.push(`[${role}] ${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`)
              }
            }
          }
          reply({
            type: 'getSessionContextPreview-done',
            preview: {
              sessionId: currentSessionId,
              messageCount: msgCount,
              estimatedChars: estChars,
              snippets: lines,
            },
          })
        } catch (e: any) {
          reply({ type: 'error', error: `getSessionContextPreview failed: ${e.message}` })
        }
        break
      }
      case 'getSkillsList': {
        try {
          const skills: any[] = []
          if (session) {
            const raw = (session.resourceLoader as any).getSkills?.()
            for (const sk of raw?.skills || []) {
              skills.push({
                name: sk.name,
                description: sk.description || '',
                path: sk.path || sk.filePath,
                source: sk.sourceInfo?.source || sk.source,
              })
            }
          }
          reply({ type: 'getSkillsList-done', skills })
        } catch (e: any) {
          reply({ type: 'error', error: `getSkillsList failed: ${e.message}` })
        }
        break
      }
      case 'getCommandCompletions': {
        try {
          const items: any[] = []
          if (session) {
            const cmd = session.extensionRunner.getCommand(msg.commandName)
            if (cmd?.getArgumentCompletions) {
              const result = await cmd.getArgumentCompletions(msg.argumentPrefix || '')
              if (Array.isArray(result)) items.push(...result)
            }
          }
          reply({ type: 'getCommandCompletions-done', items })
        } catch (e: any) {
          reply({ type: 'getCommandCompletions-done', items: [], error: e.message })
        }
        break
      }
      case 'getState': {
        reply({
          type: 'getState-done',
          state: session
            ? {
                sessionId: session.sessionId,
                sessionName: session.sessionName,
                model: session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined,
                thinkingLevel: session.thinkingLevel,
                isStreaming: session.isStreaming,
                sessionFile: session.sessionFile,
                messageCount: session.messages.length,
                tools: ((session as any).agent?._state?.tools || []).map((t: any) => ({
                  name: t.name,
                  description: t.description,
                })),
              }
            : null,
        })
        break
      }
      case 'getMessages': {
        // Read a session JSONL file and return normalized timeline items
        try {
          const { pathToFileURL, fileURLToPath } = await import('node:url')
          const { dirname, join } = await import('node:path')
          // Resolve the package dir via import.meta.resolve (handles exports field)
          const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
          const resolved = fileURLToPath(mainUrl)
          const pkgRoot = dirname(dirname(resolved))
          const smPath = join(pkgRoot, 'dist', 'core', 'session-manager.js')
          const sm: any = await import(pathToFileURL(smPath).href)
          const entries = sm.loadEntriesFromFile(msg.sessionFile)
          const ctx = sm.buildSessionContext(entries)
          const items = normalizeMessages(ctx.messages)
          reply({ type: 'getMessages-done', items })
        } catch (e: any) {
          reply({ type: 'error', error: `getMessages failed: ${e.message}` })
        }
        break
      }
      case 'loadSession': {
        try {
          if (unsubscribe) { unsubscribe(); unsubscribe = null }
          session?.dispose()
          const agentDir = getAgentDir()
          const settingsManager = SettingsManager.create(currentCwd, agentDir)
          const resourceLoader = new DefaultResourceLoader({
            cwd: currentCwd,
            agentDir,
            settingsManager,
            eventBus: sharedEventBus,
          })
          await resourceLoader.reload()
          const sm = SessionManager.open(msg.sessionFile)
          const { session: newSession } = await createAgentSession({
            cwd: currentCwd,
            agentDir,
            settingsManager,
            resourceLoader,
            sessionManager: sm,
          })
          session = newSession
          currentSessionId = session.sessionId
          await bindDesktopExtensions(session)
          unsubscribe = session.subscribe((event: AgentSessionEvent) => handleSessionEvent(event))
          const modelStr = session.model ? `${(session.model as any).provider}/${(session.model as any).modelId}` : undefined
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
          reply({ type: 'loadSession-done', sessionId: currentSessionId, model: modelStr, thinkingLevel: session.thinkingLevel })
        } catch (e: any) {
          reply({ type: 'error', error: `loadSession failed: ${e.message}` })
        }
        break
      }
      case 'extension-ui-response': {
        uiBridge?.handleExtensionUIResponse(msg.response as ExtensionUIResponse)
        reply({ type: 'extension-ui-response-done' })
        break
      }
      case 'getPiSettings': {
        try {
          const sm = session?.settingsManager
            ?? SettingsManager.create(currentCwd || process.cwd(), getAgentDir())
          reply({
            type: 'getPiSettings-done',
            settings: {
              defaultProvider: sm.getDefaultProvider(),
              defaultModel: sm.getDefaultModel(),
              defaultThinkingLevel: sm.getDefaultThinkingLevel(),
              steeringMode: sm.getSteeringMode(),
              followUpMode: sm.getFollowUpMode(),
              transport: sm.getTransport(),
              compactionEnabled: sm.getCompactionEnabled(),
              shellPath: sm.getShellPath(),
              imageAutoResize: sm.getImageAutoResize(),
              enabledModels: sm.getEnabledModels(),
              sessionDir: sm.getSessionDir(),
            },
          })
        } catch (e: any) {
          reply({ type: 'error', error: `getPiSettings failed: ${e.message}` })
        }
        break
      }
      case 'setPiSettings': {
        try {
          const sm = session?.settingsManager
            ?? SettingsManager.create(currentCwd || process.cwd(), getAgentDir())
          const patch = msg.patch || {}
          if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
            sm.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel)
          } else if (patch.defaultProvider !== undefined) sm.setDefaultProvider(patch.defaultProvider)
          else if (patch.defaultModel !== undefined) sm.setDefaultModel(patch.defaultModel)
          if (patch.defaultThinkingLevel !== undefined) sm.setDefaultThinkingLevel(patch.defaultThinkingLevel)
          if (patch.steeringMode !== undefined) sm.setSteeringMode(patch.steeringMode)
          if (patch.followUpMode !== undefined) sm.setFollowUpMode(patch.followUpMode)
          if (patch.transport !== undefined) sm.setTransport(patch.transport)
          if (patch.compactionEnabled !== undefined) sm.setCompactionEnabled(patch.compactionEnabled)
          if (patch.shellPath !== undefined) sm.setShellPath(patch.shellPath)
          if (patch.imageAutoResize !== undefined) sm.setImageAutoResize(patch.imageAutoResize)
          if (patch.enabledModels !== undefined) sm.setEnabledModels(patch.enabledModels)
          reply({ type: 'setPiSettings-done', ok: true })
        } catch (e: any) {
          reply({ type: 'error', error: `setPiSettings failed: ${e.message}` })
        }
        break
      }
      case 'dispose': {
        uiBridge?.dispose()
        uiBridge = null
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
        session?.dispose()
        session = null
        reply({ type: 'dispose-done' })
        break
      }
      case 'ping': {
        reply({ type: 'pong' })
        break
      }
    }
  } catch (error) {
    reply({ type: 'error', error: String(error), stack: (error as Error)?.stack })
  }
})

console.log('[Worker] Ready')
