// Pi Worker - runs pi SDK in a utilityProcess via MessagePort
// Entry point spawned by Electron utilityProcess as ESM (.mjs)

// 关键：pi-intercom 在 Windows 默认用 process.execPath 当 node 跑 tsx broker.ts。
// Electron Worker 里 execPath = electron.exe，不加此 env 会 spawn 出 GUI Electron 进程而非 node，
// 导致 broker.ts 不执行、socket 无人监听、Worker init 反复重拉 → 进程风暴 + Windows 通知/抢焦点。
process.env.ELECTRON_RUN_AS_NODE = '1'

import type {
  AgentSession,
  AgentSessionEvent,
  EventBus,
} from '@earendil-works/pi-coding-agent'
import type { AppEvent } from '@shared/app-events'
import { formatSessionModelKey, type SessionModelRef } from '@shared/worker-model'
import { resolveModelFromRegistry, type PiModelRegistryLike } from '@shared/pi-model-registry'
import {
  extractTextFromPiMessage,
  extractToolResultFromPiMessage,
  piMessageTimestamp,
  piUsageTotals,
  type PiCompactionEndResult,
  type PiSessionMessage,
} from '@shared/worker-message'
import { createDesktopUIBridge, type DesktopUIBridge, type ExtensionUIResponse } from './desktop-ui-bridge.js'
import { resolveInteractByTool } from '../extension-compat/adapter-loader.js'
import { extractJsonPath } from '../extension-compat/json-path.js'

let sdk: typeof import('@earendil-works/pi-coding-agent') | null = null
let activeSdkPath: string | null = null
let sharedEventBus: EventBus | null = null
let session: AgentSession | null = null
let uiBridge: DesktopUIBridge | null = null
let seq = 0
let currentCwd = ''
let currentSessionId = ''
let currentRunId = ''
let currentTurnId = ''
let unsubscribe: (() => void) | null = null
/** 仅 agent_start…agent_end 之间允许向桌面转发交互式 extension-ui（非 notify） */
let agentTurnActive = false
let promptSent = false

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

function currentSessionModelKey(): string | undefined {
  return session ? formatSessionModelKey(session.model as SessionModelRef) : undefined
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
  agentTurnActive = false
  promptSent = false
  if (session) {
    session.dispose()
    session = null
  }

  currentCwd = cwd

  const agentDir = sdk!.getAgentDir()
  const settingsManager = sdk!.SettingsManager.create(cwd, agentDir)
  const resourceLoader = new sdk!.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    eventBus: sharedEventBus!,
  })
  await resourceLoader.reload()

  const { session: newSession, modelFallbackMessage } = await sdk!.createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader,
    sessionManager: sdk!.SessionManager.create(cwd),
  })

  session = newSession
  currentSessionId = session.sessionId
  await bindDesktopExtensions(session)

  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event)
  })

  // 勿 emit idle：新建/重载会话后 idle 会让 Renderer 误判「已结束」，抹掉首条乐观等待态
  if (session) {
    const modelStr = currentSessionModelKey()
    emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
  }

  if (modelFallbackMessage) {
    console.warn('[Worker] Model fallback:', modelFallbackMessage)
  }
}

/** Same wiring as pi RPC mode — required for pi-rewind /rewind (navigateTree + hasUI). */
function buildCommandContextActions(sess: AgentSession) {
  return {
    waitForIdle: () => sess.agent.waitForIdle(),
    newSession: async () => ({ cancelled: true }),
    fork: async () => ({ cancelled: true }),
    navigateTree: async (targetId: string, options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string }) => {
      const result = await sess.navigateTree(targetId, {
        summarize: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      })
      return { cancelled: result.cancelled }
    },
    switchSession: async () => ({ cancelled: true }),
    reload: async () => {
      await sess.reload()
    },
  }
}

function workerTraceOn(): boolean {
  return (
    process.env.PI_AUDIO_TRACE === '1' ||
    process.env.PI_AUDIO_TRACE === 'true' ||
    process.env.PI_ALERT_TRACE === '1'
  )
}

function traceWorkerUi(req: import('./desktop-ui-bridge.js').ExtensionUIRequest, forwarded: boolean): void {
  if (!workerTraceOn()) return
  const detail =
    req.method === 'notify'
      ? { method: 'notify', notifyType: req.notifyType, msg: String(req.message || '').slice(0, 100) }
      : { method: req.method, kind: (req as { kind?: string }).kind }
  console.log('[audio-trace] worker.postExtensionUi', { forwarded, agentTurnActive, ...detail })
}

function postExtensionUiToDesktop(req: import('./desktop-ui-bridge.js').ExtensionUIRequest): void {
  // Dialog requests (confirm/select/input/editor/custom) must always be forwarded so
  // navigateTree and other non-turn UI calls can complete. Only notify is gated by agentTurnActive.
  if (req.method === 'notify') {
    if (!agentTurnActive) {
      if (req.notifyType === 'error') {
        traceWorkerUi(req, true)
        process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
      } else {
        traceWorkerUi(req, false)
      }
      return
    }
  }
  traceWorkerUi(req, true)
  process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
}

function postExtensionUiDismiss(id: string, reason: 'timeout' | 'abort'): void {
  process.parentPort?.postMessage({ type: 'extension-ui-dismiss', id, reason })
}

async function bindDesktopExtensions(sess: AgentSession): Promise<void> {
  if (!uiBridge) {
    uiBridge = createDesktopUIBridge(sharedEventBus!, postExtensionUiToDesktop, postExtensionUiDismiss)
  }
  await sess.bindExtensions({
    uiContext: uiBridge.uiContext as never,
    mode: 'rpc',
    commandContextActions: buildCommandContextActions(sess),
  })
}

function lastAssistantFromMessages(messages: any[]): any | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') return messages[i]
  }
  return undefined
}

function emitAgentErrorFromAssistant(
  base: ReturnType<typeof baseEvent>,
  msg: PiSessionMessage & { errorMessage?: string },
): void {
  const stop = msg?.stopReason as string | undefined
  if (stop !== 'error' && stop !== 'aborted') return
  const raw =
    (typeof msg?.errorMessage === 'string' && msg.errorMessage.trim()) ||
    extractTextFromPiMessage(msg) ||
    (stop === 'aborted' ? 'Request was aborted.' : 'Unknown error')
  emit({
    ...base,
    type: 'agent_error',
    text: String(raw),
    kind: stop === 'aborted' ? 'aborted' : 'error',
    stopReason: stop,
  })
}

function handleSessionEvent(event: AgentSessionEvent): void {
  const base = baseEvent()

  switch (event.type) {
    case 'agent_start': {
      agentTurnActive = true
      currentRunId = `run-${nextSeq()}`
      currentTurnId = `turn-${nextSeq()}`
      emit({ ...base, type: 'run', phase: 'running' })
      break
    }
    case 'agent_end': {
      if (!agentTurnActive) {
        if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_AUDIO_TRACE === 'true') {
          console.log('[audio-trace] worker.agent_end_ignored', { agentTurnActive })
        }
        break
      }
      agentTurnActive = false
      const willRetry = !!(event as { willRetry?: boolean }).willRetry
      if (!willRetry) {
        const last = lastAssistantFromMessages((event as { messages?: any[] }).messages || [])
        if (last && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
          emit({ ...base, type: 'run', phase: 'failed' })
        }
      }
      if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_AUDIO_TRACE === 'true') {
        console.log('[audio-trace] worker.emit_run_idle')
      }
      emit({ ...base, type: 'run', phase: 'idle' })
      break
    }
    case 'turn_start': {
      currentTurnId = `turn-${nextSeq()}`
      break
    }
    case 'turn_end': {
      const msg = event.message as PiSessionMessage
      const totals = piUsageTotals(msg?.usage)
      if (totals) {
        emit({ ...base, type: 'run', phase: 'running', usage: totals })
      }
      break
    }
    case 'message_start': {
      const msg = event.message as PiSessionMessage
      if (msg?.role === 'assistant') {
        emit({ ...base, type: 'message', role: 'assistant', phase: 'start' })
      }
      break
    }
    case 'message_update': {
      const ame = event.assistantMessageEvent as { type?: string; delta?: string; content?: string; text?: string } | undefined
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
        emit({ ...base, type: 'message', role: 'assistant', phase: 'delta', text: chunk, contentKind: 'thinking' })
      } else if (ame?.type === 'text_delta') {
        emit({ ...base, type: 'message', role: 'assistant', phase: 'delta', text: chunk, contentKind: 'text' })
      }
      break
    }
    case 'message_end': {
      const msg = event.message as PiSessionMessage
      const entryId = session?.sessionManager?.getLeafId?.() ?? undefined
      if (msg?.role === 'assistant') {
        const text = extractTextFromPiMessage(msg)
        emit({ ...base, type: 'message', role: 'assistant', phase: 'end', text, sessionEntryId: entryId })
        emitAgentErrorFromAssistant(base, msg)
      } else if (msg?.role === 'user') {
        emit({ ...base, type: 'message', role: 'user', phase: 'end', sessionEntryId: entryId })
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
        const args = (event as { args?: { path?: string } }).args
        if (args?.path) {
          emit({ ...base, type: 'file', source: event.toolName, path: args.path, changeType: event.toolName === 'write' ? 'added' : 'modified' })
        }
      }
      break
    }
    case 'compaction_start': {
      emit({ ...base, type: 'compaction', phase: 'start' })
      process.parentPort?.postMessage({ type: 'extension-ui-dismiss-all', reason: 'compaction' })
      break
    }
    case 'session_info_changed':
    case 'thinking_level_changed': {
      // Push current model + thinking level to renderer for live status bar update
      if (session) {
        const modelStr = currentSessionModelKey()
        emit({ ...base, type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
      }
      break
    }
    case 'queue_update': {
      emit({
        ...base,
        type: 'queue',
        steering: [...(event.steering || [])],
        followUp: [...(event.followUp || [])],
      })
      break
    }
    case 'auto_retry_end': {
      const e = event as { success?: boolean; finalError?: string; attempt?: number }
      if (!e.success && e.finalError) {
        const raw = e.finalError
        emit({
          ...base,
          type: 'agent_error',
          text: e.attempt
            ? `Aborted after ${e.attempt} retry attempt\n${raw}`
            : String(raw),
          kind: 'retry',
          stopReason: 'error',
        })
        emit({ ...base, type: 'run', phase: 'failed' })
      }
      break
    }
    case 'compaction_end': {
      const e = event as { errorMessage?: string; aborted?: boolean }
      if (e.errorMessage && !e.aborted) {
        emit({
          ...base,
          type: 'agent_error',
          text: String(e.errorMessage),
          kind: 'error',
          stopReason: 'error',
        })
      }
      {
        const cr = (event as { result?: PiCompactionEndResult }).result
        emit({ ...base, type: 'compaction', phase: 'end', tokensSaved: cr?.tokensBefore, summary: cr?.summary })
      }
      break
    }
  }
}

async function listSessions(cwd: string): Promise<any[]> {
  if (!sdk) return []
  try {
    return await sdk.SessionManager.list(cwd)
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
  const toolCallIndex = new Map<string, number>()

  for (const m of messages) {
    const pm = m as PiSessionMessage & { toolCallId?: string; toolName?: string }
    const ts = piMessageTimestamp(pm, now)
    const content = Array.isArray(pm.content) ? pm.content : []

    if (pm.role === 'user') {
      const text = extractText(pm)
      if (text) items.push({ id: `hist-${++msgSeq}`, type: 'user-message', text, timestamp: ts })
    } else if (pm.role === 'assistant') {
      const text = extractText(pm)
      const toolCalls = content.filter((c) => (c as { type?: string }).type === 'toolCall')
      if (text) {
        items.push({ id: `hist-${++msgSeq}`, type: 'assistant-message', text, timestamp: ts })
      }
      for (const c of toolCalls) {
        const tc = c as { toolCall?: { name?: string; input?: unknown; arguments?: unknown; id?: string } }
        const name = tc.toolCall?.name || 'tool'
        const input = tc.toolCall?.input || tc.toolCall?.arguments
        const callId = tc.toolCall?.id || ''
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
    } else if (pm.role === 'toolResult') {
      const text = extractToolResult(pm)
      const callId = pm.toolCallId || ''
      const toolName = pm.toolName || ''
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
    } else if (pm.role === 'compactionSummary' || pm.role === 'branchSummary') {
      const text = extractText(pm)
      items.push({ id: `hist-${++msgSeq}`, type: 'compaction', text, timestamp: ts })
    }
  }
  return items
}

/** 按当前 leaf 的 getBranch() 顺序建时间线，与 TUI 树上路径一致，避免 role 对齐错位。 */
function timelineItemsFromBranchPath(path: any[]): any[] {
  const items: any[] = []
  const toolCallIndex = new Map<string, number>()
  const now = Date.now()

  for (const entry of path) {
    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : now
    const sid = entry.id as string | undefined

    if (entry.type === 'compaction' && entry.summary) {
      items.push({
        id: `hist-${++msgSeq}`,
        type: 'compaction',
        text: String(entry.summary),
        timestamp: ts,
        sessionEntryId: sid,
      })
      continue
    }
    if (entry.type === 'branch_summary' && entry.summary) {
      items.push({
        id: `hist-${++msgSeq}`,
        type: 'compaction',
        text: String(entry.summary),
        timestamp: ts,
        sessionEntryId: sid,
      })
      continue
    }
    if (entry.type !== 'message' || !entry.message) continue

    const m = entry.message
    const content = m.content || []

    if (m.role === 'user') {
      const text = extractText(m)
      if (text) {
        items.push({ id: `hist-${++msgSeq}`, type: 'user-message', text, timestamp: ts, sessionEntryId: sid })
      }
    } else if (m.role === 'assistant') {
      const text = extractText(m)
      const toolCalls = content.filter((c: any) => c.type === 'toolCall')
      if (text) {
        items.push({
          id: `hist-${++msgSeq}`,
          type: 'assistant-message',
          text,
          timestamp: ts,
          sessionEntryId: sid,
        })
      }
      for (const c of toolCalls) {
        const name = c.name || c.toolCall?.name || 'tool'
        const input = c.arguments ?? c.toolCall?.input ?? c.toolCall?.arguments
        const callId = c.id || c.toolCall?.id || ''
        const item: any = {
          id: `hist-${++msgSeq}`,
          type: 'tool-call',
          toolName: name,
          toolArgs: input || undefined,
          toolPhase: 'end',
          toolOutput: '',
          timestamp: ts,
          sessionEntryId: sid,
        }
        const idx = items.length
        items.push(item)
        if (callId) toolCallIndex.set(callId, idx)
      }
    } else if (m.role === 'toolResult') {
      const text = extractText(m)
      const callId = m.toolCallId || ''
      const toolName = m.toolName || ''
      let targetIdx = callId ? toolCallIndex.get(callId) : undefined
      if (targetIdx === undefined) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].type === 'tool-call' && !items[i].toolOutput && (!toolName || items[i].toolName === toolName)) {
            targetIdx = i
            break
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
          sessionEntryId: sid,
        })
      }
    }
  }
  return items
}

const extractText = extractTextFromPiMessage
const extractToolResult = extractToolResultFromPiMessage

/** Pi SettingsManager has getters but no setters for compaction token fields — write via globalSettings + markModified. */
function patchPiCompactionTokens(
  sm: any,
  patch: { compactionReserveTokens?: unknown; compactionKeepRecentTokens?: unknown },
) {
  const gs = (sm as any).globalSettings as Record<string, any>
  if (!gs.compaction) gs.compaction = {}
  if (patch.compactionReserveTokens !== undefined) {
    const n = Math.floor(Number(patch.compactionReserveTokens))
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid compaction.reserveTokens')
    gs.compaction.reserveTokens = n
    ;(sm as any).markModified('compaction', 'reserveTokens')
  }
  if (patch.compactionKeepRecentTokens !== undefined) {
    const n = Math.floor(Number(patch.compactionKeepRecentTokens))
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid compaction.keepRecentTokens')
    gs.compaction.keepRecentTokens = n
    ;(sm as any).markModified('compaction', 'keepRecentTokens')
  }
  if (patch.compactionReserveTokens !== undefined || patch.compactionKeepRecentTokens !== undefined) {
    ;(sm as any).save()
  }
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
          activeSdkPath = typeof msg.sdkPath === 'string' && msg.sdkPath ? msg.sdkPath : null
          let sdkFallback = false
          try {
            if (activeSdkPath) {
              const { isAbsolute } = await import('node:path')
              const { pathToFileURL } = await import('node:url')
              if (isAbsolute(activeSdkPath)) {
                sdk = await import(pathToFileURL(activeSdkPath).href)
              } else {
                sdk = await import(activeSdkPath)
              }
            } else {
              sdk = await import('@earendil-works/pi-coding-agent')
            }
          } catch (e: any) {
            console.error('[Worker] Dynamic import SDK failed, fallback to builtin:', e.message)
            activeSdkPath = null
            sdk = await import('@earendil-works/pi-coding-agent')
            sdkFallback = true
          }
          if (!sdk) throw new Error('SDK load failed')
          if (!sharedEventBus) sharedEventBus = sdk.createEventBus()
          await initSession(msg.cwd)
          console.log('[Worker] Init done, sessionId:', currentSessionId)
          reply({ type: 'init-done', sessionId: currentSessionId, model: currentSessionModelKey(), thinkingLevel: session?.thinkingLevel, sdkFallback })
        } catch (e: any) {
          console.error('[Worker] Init FAILED:', e.message, e.stack)
          reply({ type: 'error', error: `Init failed: ${e.message}`, stack: e.stack })
        }
        break
      }
      case 'prompt': {
        if (!session) { reply({ type: 'error', error: 'No session' }); break }
        const promptText = String(msg.text ?? '').trim()
        const slashMatch = promptText.match(/^(\/\S+)/)
        if (slashMatch) {
          emit({
            ...baseEvent(),
            type: 'slash',
            command: slashMatch[1],
            status: 'dispatched',
            text: '已发送给 pi 执行',
          })
        }
        promptSent = true
        reply({ type: 'prompt-done' })
        void (async () => {
          try {
            await session.prompt(promptText, msg.options)
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'ok',
                text: '命令已执行（详见下方助手/工具输出）',
              })
            }
            if (!agentTurnActive) {
              emit({ ...baseEvent(), type: 'run', phase: 'idle' })
            }
          } catch (e: any) {
            console.error('[Worker] prompt failed:', e)
            const errText = e?.message || String(e)
            emit({
              ...baseEvent(),
              type: 'agent_error',
              text: errText,
              kind: 'error',
              stopReason: 'error',
            })
            emit({ ...baseEvent(), type: 'run', phase: 'failed' })
            emit({ ...baseEvent(), type: 'run', phase: 'idle' })
            if (slashMatch) {
              emit({
                ...baseEvent(),
                type: 'slash',
                command: slashMatch[1],
                status: 'error',
                text: `执行失败: ${errText}`,
              })
            }
          }
        })()
        break
      }
      case 'abort': {
        const wasActive = agentTurnActive
        if (session) {
          try {
            session.clearQueue()
          } catch (e) {
            console.error('[Worker] clearQueue on abort failed:', e)
          }
        }
        try {
          session?.abortRetry?.()
          session?.agent?.abort?.()
        } catch (e: any) {
          console.error('[Worker] abort failed:', e)
        }
        agentTurnActive = false
        if (wasActive) {
          emit({
            ...baseEvent(),
            type: 'agent_error',
            text: 'Request was aborted.',
            kind: 'aborted',
            stopReason: 'aborted',
          })
        }
        emit({ ...baseEvent(), type: 'run', phase: 'idle' })
        reply({ type: 'abort-done' })
        break
      }
      case 'steer': {
        await session?.steer(msg.text)
        reply({ type: 'steer-done' })
        break
      }
      case 'followUp': {
        if (!session) { reply({ type: 'error', error: 'No session' }); break }
        reply({ type: 'followUp-done' })
        void session.followUp(msg.text).catch((e: any) => {
          console.error('[Worker] followUp failed:', e)
          const errText = e?.message || String(e)
          emit({
            ...baseEvent(),
            type: 'agent_error',
            text: errText,
            kind: 'error',
            stopReason: 'error',
          })
          emit({ ...baseEvent(), type: 'run', phase: 'failed' })
          emit({ ...baseEvent(), type: 'run', phase: 'idle' })
        })
        break
      }
      case 'clearQueue': {
        if (!session) { reply({ type: 'clearQueue-done', steering: [], followUp: [] }); break }
        const cleared = session.clearQueue()
        reply({ type: 'clearQueue-done', steering: cleared.steering || [], followUp: cleared.followUp || [] })
        break
      }
      case 'setModel': {
        if (session) {
          try {
            // Resolve model from the session's modelRegistry (no dynamic pi-ai import — it's a nested dep not hoisted).
            const model = resolveModelFromRegistry(session.modelRegistry as PiModelRegistryLike, msg.provider, msg.modelId)
            if (model) await session.setModel(model as Parameters<typeof session.setModel>[0])
            const modelStr = currentSessionModelKey()
            emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
          } catch (e) { console.error('[Worker] setModel failed:', e) }
        }
        reply({ type: 'setModel-done' })
        break
      }
      case 'setThinkingLevel': {
        session?.setThinkingLevel(msg.level)
        if (session) {
          const modelStr = currentSessionModelKey()
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
        }
        reply({ type: 'setThinkingLevel-done' })
        break
      }
      case 'newSession': {
        if (promptSent) {
          if (unsubscribe) { unsubscribe(); unsubscribe = null }
          if (session) { session.dispose(); session = null }
          await initSession(currentCwd)
        }
        promptSent = false
        reply({ type: 'newSession-done', sessionId: currentSessionId })
        break
      }
      case 'listSessions': {
        const sessions = await listSessions(msg.cwd || currentCwd)
        reply({ type: 'listSessions-done', sessions })
        break
      }
      case 'reloadModels': {
        try {
          session?.modelRegistry?.refresh?.()
          reply({ type: 'reloadModels-done', ok: true })
        } catch (e: any) {
          reply({ type: 'error', error: `reloadModels failed: ${e.message}` })
        }
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
          const segments: { index: number; role: string; chars: number; preview: string; label?: string }[] = []
          let msgCount = 0
          let estChars = 0
          if (session) {
            for (const m of session.messages || []) {
              msgCount++
              const hm = m as PiSessionMessage
              const t = extractText(hm)
              estChars += t.length
              const role = hm.role || '?'
              let label: string | undefined
              if (role === 'toolResult' && hm.toolName) label = hm.toolName
              if (role === 'assistant' && Array.isArray(hm.content)) {
                const tools = hm.content
                  .filter((c) => (c as { type?: string }).type === 'toolCall')
                  .map((c) => (c as { toolCall?: { name?: string } }).toolCall?.name)
                  .filter(Boolean)
                if (tools.length) label = tools.join(', ')
              }
              segments.push({
                index: segments.length,
                role,
                chars: t.length,
                preview: t.slice(0, 280),
                label,
              })
              if (lines.length < 12 && t) {
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
              segments,
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
                path: sk.path || sk.filePath || sk.skillPath,
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
      case 'getPromptTemplatesList': {
        try {
          const prompts: any[] = []
          if (session) {
            for (const tpl of session.promptTemplates || []) {
              prompts.push({
                name: tpl.name,
                description: tpl.description || '',
                path: (tpl as any).path || (tpl as any).filePath,
                source: (tpl as any).sourceInfo?.source,
              })
            }
          }
          reply({ type: 'getPromptTemplatesList-done', prompts })
        } catch (e: any) {
          reply({ type: 'error', error: `getPromptTemplatesList failed: ${e.message}` })
        }
        break
      }
      case 'getContextPrompts': {
        try {
          const rl = session?.resourceLoader
          const agentsFiles = rl?.getAgentsFiles?.()?.agentsFiles ?? []
          const systemPromptFile = rl?.getSystemPrompt?.() ?? undefined
          const appendParts = rl?.getAppendSystemPrompt?.() ?? []
          const builtSystemPreview = session?.systemPrompt?.slice(0, 12000) ?? ''
          reply({
            type: 'getContextPrompts-done',
            agentsFiles,
            systemPromptFile: systemPromptFile ?? null,
            appendSystemPromptParts: appendParts,
            builtSystemPreview,
            projectTrusted: session?.settingsManager?.isProjectTrusted?.() ?? true,
          })
        } catch (e: any) {
          reply({ type: 'error', error: `getContextPrompts failed: ${e.message}` })
        }
        break
      }
      case 'reloadResources': {
        try {
          if (session) {
            await (session as any).reload?.()
          }
          reply({ type: 'reloadResources-done', ok: true })
        } catch (e: any) {
          reply({ type: 'error', error: `reloadResources failed: ${e.message}` })
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
                model: (() => {
                  const m = session.model as { provider?: string; modelId?: string } | null
                  if (!m?.provider || !m?.modelId) return undefined
                  const id = String(m.modelId)
                  if (!id || id === 'undefined') return undefined
                  return `${m.provider}/${id}`
                })(),
                thinkingLevel:
                  session.thinkingLevel != null && String(session.thinkingLevel).trim()
                    ? String(session.thinkingLevel)
                    : undefined,
                isStreaming: session.isStreaming,
                sessionFile: session.sessionFile,
                leafId: session.sessionManager.getLeafId?.() ?? null,
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
        try {
          const { pathToFileURL, fileURLToPath } = await import('node:url')
          const { dirname, join, isAbsolute } = await import('node:path')
          // activeSdkPath 现为完整入口文件路径（.../dist/index.js）；两分支统一 dirname(dirname) 得包根
          let pkgRoot: string
          if (activeSdkPath && isAbsolute(activeSdkPath)) {
            pkgRoot = dirname(dirname(activeSdkPath))
          } else {
            const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
            const resolved = fileURLToPath(mainUrl)
            pkgRoot = dirname(dirname(resolved))
          }
          const smPath = join(pkgRoot, 'dist', 'core', 'session-manager.js')
          const sm: any = await import(pathToFileURL(smPath).href)
          const smOpen = sm.SessionManager.open(msg.sessionFile)
          if (session && session.sessionFile === msg.sessionFile) {
            const leafId = session.sessionManager.getLeafId?.() ?? null
            if (leafId === null) smOpen.resetLeaf()
            else smOpen.branch(leafId)
          }
          const ctx = smOpen.buildSessionContext()
          const sessionMeta: { model?: string; thinkingLevel?: string } = {}
          if (ctx.thinkingLevel) sessionMeta.thinkingLevel = String(ctx.thinkingLevel)
          if (ctx.model?.provider && ctx.model?.modelId) {
            sessionMeta.model = `${ctx.model.provider}/${ctx.model.modelId}`
          }
          const branchPath = smOpen.getBranch()
          const all = timelineItemsFromBranchPath(branchPath)
          const totalCount = all.length
          const offset = Math.max(0, Number(msg.offset) || 0)
          const limit = Math.min(500, Math.max(1, Number(msg.limit) || totalCount || 1))
          let items: typeof all
          if (offset === 0 && limit < totalCount) {
            items = all.slice(Math.max(0, totalCount - limit))
          } else if (offset > 0) {
            const end = totalCount - offset
            const start = Math.max(0, end - limit)
            items = all.slice(start, end)
          } else {
            items = all
          }
          reply({ type: 'getMessages-done', items, totalCount, sessionMeta })
        } catch (e: any) {
          reply({ type: 'error', error: `getMessages failed: ${e.message}` })
        }
        break
      }
      case 'loadSession': {
        try {
          const targetFile = msg.sessionFile as string
          if (session?.sessionFile === targetFile) {
            const modelStr = currentSessionModelKey()
            reply({
              type: 'loadSession-done',
              sessionId: currentSessionId,
              model: modelStr,
              thinkingLevel: session.thinkingLevel,
            })
            break
          }
          agentTurnActive = false
          if (unsubscribe) { unsubscribe(); unsubscribe = null }
          session?.dispose()
          const agentDir = sdk!.getAgentDir()
          const settingsManager = sdk!.SettingsManager.create(currentCwd, agentDir)
          const resourceLoader = new sdk!.DefaultResourceLoader({
            cwd: currentCwd,
            agentDir,
            settingsManager,
            eventBus: sharedEventBus!,
          })
          await resourceLoader.reload()
          const sm = sdk!.SessionManager.open(msg.sessionFile)
          const { session: newSession } = await sdk!.createAgentSession({
            cwd: currentCwd,
            agentDir,
            settingsManager,
            resourceLoader,
            sessionManager: sm,
          })
          session = newSession
          currentSessionId = session.sessionId
          await bindDesktopExtensions(session)
          promptSent = true
          unsubscribe = session.subscribe((event: AgentSessionEvent) => handleSessionEvent(event))
          const modelStr = currentSessionModelKey()
          emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
          reply({ type: 'loadSession-done', sessionId: currentSessionId, model: modelStr, thinkingLevel: session.thinkingLevel })
        } catch (e: any) {
          reply({ type: 'error', error: `loadSession failed: ${e.message}` })
        }
        break
      }
      case 'sessionRenameFile': {
        try {
          const file = msg.sessionFile as string
          const title = String(msg.title || '').trim()
          if (!file || !title) {
            reply({ type: 'sessionRenameFile-done', ok: false, error: 'missing file or title' })
            break
          }
          if (session?.sessionFile === file) {
            session.setSessionName(title)
          } else {
            const sm = sdk!.SessionManager.open(file, undefined, currentCwd)
            sm.appendSessionInfo(title)
          }
          reply({ type: 'sessionRenameFile-done', ok: true, title })
        } catch (e: any) {
          reply({ type: 'sessionRenameFile-done', ok: false, error: e.message })
        }
        break
      }
      case 'getSessionTree': {
        if (!session) {
          reply({ type: 'getSessionTree-done', nodes: [], leafId: null })
          break
        }
        try {
          const sm = session.sessionManager
          const leafId = sm.getLeafId?.() ?? null
          type FlatNode = {
            id: string
            parentId: string | null
            depth: number
            label?: string
            entryType: string
            timestamp?: string
            isLeaf: boolean
            role?: string
            preview?: string
          }
          const previewFromMsg = (msg: any): string => {
            const c = msg?.content
            if (typeof c === 'string') return c.trim().slice(0, 120)
            if (!Array.isArray(c)) return ''
            return c
              .filter((p: any) => p?.type === 'text')
              .map((p: any) => p.text || '')
              .join('')
              .trim()
              .slice(0, 120)
          }
          const flat: FlatNode[] = []
          const walk = (nodes: any[], depth: number, parentId: string | null) => {
            for (const n of nodes) {
              const e = n.entry
              const id = e?.id as string
              if (!id) continue
              const row: FlatNode = {
                id,
                parentId,
                depth,
                label: n.label || undefined,
                entryType: e?.type || 'unknown',
                timestamp: e?.timestamp,
                isLeaf: id === leafId,
              }
              if (e?.type === 'message' && e.message) {
                row.role = e.message.role
                row.preview = previewFromMsg(e.message)
              }
              flat.push(row)
              if (n.children?.length) walk(n.children, depth + 1, id)
            }
          }
          walk(sm.getTree(), 0, null)
          reply({ type: 'getSessionTree-done', nodes: flat, leafId })
        } catch (e: any) {
          reply({ type: 'error', error: `getSessionTree failed: ${e.message}` })
        }
        break
      }
      case 'navigateTree': {
        if (!session) { reply({ type: 'error', error: 'No session' }); break }
        try {
          const result = await session.navigateTree(msg.targetId, {
            summarize: msg.summarize === true,
            customInstructions: msg.customInstructions,
            replaceInstructions: msg.replaceInstructions,
            label: msg.label,
          })
          const leafId = session.sessionManager.getLeafId?.() ?? null
          reply({
            type: 'navigateTree-done',
            cancelled: result.cancelled,
            editorText: result.editorText,
            leafId,
            sessionMeta: session.model
              ? {
                  model: currentSessionModelKey(),
                  thinkingLevel: session.thinkingLevel,
                }
              : { thinkingLevel: session.thinkingLevel },
          })
        } catch (e: any) {
          reply({ type: 'error', error: `navigateTree failed: ${e.message}` })
        }
        break
      }
      case 'runExtensionCommand': {
        if (!session) { reply({ type: 'error', error: 'No session' }); break }
        const text = String(msg.text || '').trim()
        if (!text.startsWith('/')) {
          reply({ type: 'error', error: 'Expected slash command' })
          break
        }
        reply({ type: 'runExtensionCommand-done' })
        void (async () => {
          try {
            await session!.prompt(text)
          } catch (e: any) {
            console.error('[Worker] runExtensionCommand failed:', e)
          }
        })()
        break
      }
      case 'sessionDeleteFile': {
        try {
          const file = msg.sessionFile as string
          if (!file) {
            reply({ type: 'sessionDeleteFile-done', ok: false, error: 'missing file' })
            break
          }
          const fs = await import('node:fs')
          if (session?.sessionFile === file) {
            if (unsubscribe) { unsubscribe(); unsubscribe = null }
            session.dispose()
            session = null
            await initSession(currentCwd)
          }
          if (fs.existsSync(file)) fs.unlinkSync(file)
          reply({ type: 'sessionDeleteFile-done', ok: true })
        } catch (e: any) {
          reply({ type: 'sessionDeleteFile-done', ok: false, error: e.message })
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
          if (!sdk) {
            reply({ type: 'getPiSettings-done', settings: {} })
            break
          }
          const sm = session?.settingsManager
            ?? sdk.SettingsManager.create(currentCwd || process.cwd(), sdk.getAgentDir())
          const compaction = sm.getCompactionSettings()
          const retry = sm.getRetrySettings()
          const branchSummary = sm.getBranchSummarySettings()
          reply({
            type: 'getPiSettings-done',
            settings: {
              defaultProvider: sm.getDefaultProvider(),
              defaultModel: sm.getDefaultModel(),
              defaultThinkingLevel: sm.getDefaultThinkingLevel(),
              steeringMode: sm.getSteeringMode(),
              followUpMode: sm.getFollowUpMode(),
              transport: sm.getTransport(),
              compactionEnabled: compaction.enabled,
              compactionReserveTokens: compaction.reserveTokens,
              compactionKeepRecentTokens: compaction.keepRecentTokens,
              retryEnabled: retry.enabled,
              retryMaxRetries: retry.maxRetries,
              retryBaseDelayMs: retry.baseDelayMs,
              branchSummaryReserveTokens: branchSummary.reserveTokens,
              branchSummarySkipPrompt: branchSummary.skipPrompt,
              httpIdleTimeoutMs: sm.getHttpIdleTimeoutMs(),
              shellPath: sm.getShellPath(),
              shellCommandPrefix: sm.getShellCommandPrefix(),
              npmCommand: sm.getNpmCommand(),
              imageAutoResize: sm.getImageAutoResize(),
              showImages: sm.getShowImages(),
              blockImages: sm.getBlockImages(),
              hideThinkingBlock: sm.getHideThinkingBlock(),
              enableSkillCommands: sm.getEnableSkillCommands(),
              quietStartup: sm.getQuietStartup(),
              defaultProjectTrust: sm.getDefaultProjectTrust(),
              treeFilterMode: sm.getTreeFilterMode(),
              doubleEscapeAction: sm.getDoubleEscapeAction(),
              enabledModels: sm.getEnabledModels(),
              packages: sm.getPackages(),
              extensionPaths: sm.getExtensionPaths(),
              skillPaths: sm.getSkillPaths(),
              sessionDir: sm.getSessionDir(),
              isProjectTrusted: sm.isProjectTrusted(),
              desktopSkillOverrides:
                (sm.getGlobalSettings() as { desktopSkillOverrides?: Record<string, boolean> })
                  ?.desktopSkillOverrides ?? {},
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
            ?? sdk!.SettingsManager.create(currentCwd || process.cwd(), sdk!.getAgentDir())
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
          patchPiCompactionTokens(sm, patch)
          if (patch.shellPath !== undefined) sm.setShellPath(patch.shellPath)
          if (patch.imageAutoResize !== undefined) sm.setImageAutoResize(patch.imageAutoResize)
          if (patch.enabledModels !== undefined) sm.setEnabledModels(patch.enabledModels)
          if (patch.retryEnabled !== undefined) sm.setRetryEnabled(patch.retryEnabled)
          if (patch.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(patch.hideThinkingBlock)
          if (patch.showImages !== undefined) sm.setShowImages(patch.showImages)
          if (patch.blockImages !== undefined) sm.setBlockImages(patch.blockImages)
          if (patch.enableSkillCommands !== undefined) sm.setEnableSkillCommands(patch.enableSkillCommands)
          if (patch.quietStartup !== undefined) sm.setQuietStartup(patch.quietStartup)
          if (patch.defaultProjectTrust !== undefined) sm.setDefaultProjectTrust(patch.defaultProjectTrust)
          if (patch.shellCommandPrefix !== undefined) sm.setShellCommandPrefix(patch.shellCommandPrefix)
          if (patch.npmCommand !== undefined) sm.setNpmCommand(patch.npmCommand)
          if (patch.treeFilterMode !== undefined) sm.setTreeFilterMode(patch.treeFilterMode)
          if (patch.doubleEscapeAction !== undefined) sm.setDoubleEscapeAction(patch.doubleEscapeAction)
          if (patch.httpIdleTimeoutMs !== undefined) sm.setHttpIdleTimeoutMs(Number(patch.httpIdleTimeoutMs))
          if (patch.isProjectTrusted === true) sm.setProjectTrusted(true)
          if (patch.isProjectTrusted === false) sm.setProjectTrusted(false)
          if (session && patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
            const provider = String(patch.defaultProvider)
            const modelId = String(patch.defaultModel)
            const model = resolveModelFromRegistry(session.modelRegistry as PiModelRegistryLike, provider, modelId)
            if (model) {
              try {
                await session.setModel(model as Parameters<typeof session.setModel>[0])
                const modelStr = currentSessionModelKey()
                emit({ ...baseEvent(), type: 'run', phase: 'state', model: modelStr, thinkingLevel: session.thinkingLevel })
              } catch (e) {
                console.error('[Worker] setPiSettings setModel failed:', e)
              }
            }
          }
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
