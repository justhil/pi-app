// browser_* tools (pi Desktop host capability "browser"). Registered by a hidden inline extension,
// kept OUT of the active tool set unless the user switched the capability on for the session.
// Execution happens in Main (BrowserHost); the worker only forwards calls. See
// docs/architecture/adr/ADR-desktop-host-tools.md.

import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { sendToMain } from './worker-transport.js'
import { BROWSER_CORE_TOOLS, BROWSER_NAMESPACE, BROWSER_TOOL_DEFS, BROWSER_TOOL_NAMES, leanSchema } from '@shared/browser-tools'

export { BROWSER_TOOL_NAMES }
const CALL_TIMEOUT_MS = 90_000

let api: ExtensionAPI | null = null
let enabled = false
let seq = 0
const pending = new Map<string, { resolve: (r: ToolResultPayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

type ToolResultPayload = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean }

const TOOL_SEARCH = 'tool_search'
/** tool_search was off before browser control switched it on (so switching off turns it off again). */
let addedToolSearch = false

/**
 * Desired active set. Without deferral: every browser_* tool while on. With deferral: only the core
 * tools plus tool_search; the rest stay registered as `deferred` and tool_search declares them on
 * demand (pi keeps loaded tools active on that branch).
 */
export function nextActiveTools(current: readonly string[], on: boolean, defer = false): string[] {
  const rest = current.filter((n) => !BROWSER_TOOL_NAMES.includes(n))
  if (!on) return addedToolSearch ? rest.filter((n) => n !== TOOL_SEARCH) : rest
  if (!defer) return [...rest, ...BROWSER_TOOL_NAMES]
  const loaded = current.filter((n) => BROWSER_TOOL_NAMES.includes(n) && !BROWSER_CORE_TOOLS.includes(n))
  return [...rest, ...(rest.includes(TOOL_SEARCH) ? [] : [TOOL_SEARCH]), ...BROWSER_CORE_TOOLS, ...loaded]
}

/** Deferral needs the tool_search tool (pi ≥ 0.99, loaded by the worker as a built-in). */
function canDefer(pi: ExtensionAPI): boolean {
  try {
    return pi.getAllTools().some((t) => t.name === TOOL_SEARCH)
  } catch {
    return false
  }
}

/**
 * Non-core tools are re-registered as `deferred` while browser control is on and `hidden` while it
 * is off, so tool_search cannot surface them in a session that has the capability off.
 */
function registerTools(pi: ExtensionAPI, mode: 'all-direct' | 'deferred' | 'hidden', onlyNonCore = false): void {
  for (const def of BROWSER_TOOL_DEFS) {
    const core = BROWSER_CORE_TOOLS.includes(def.name)
    if (onlyNonCore && core) continue
    pi.registerTool({
      name: def.name,
      label: def.label,
      description: def.description,
      // Plain JSON Schema: pi validates non-TypeBox schemas with its JSON Schema path.
      parameters: leanSchema(def.parameters) as unknown as ToolDefinition['parameters'],
      ...(mode === 'all-direct' || core ? {} : { exposure: mode, namespace: BROWSER_NAMESPACE }),
      ...(mode === 'all-direct' || core ? { defaultActive: false } : {}),
      async execute(_toolCallId, params, signal) {
        if (!enabled) throw new Error('browser_off: browser control is switched off for this conversation')
        const result = await callMain(def.name, params, signal)
        if (result.isError) throw new Error(result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'))
        return { content: result.content, details: {} }
      },
    })
  }
}

let registeredMode: 'all-direct' | 'deferred' | 'hidden' | null = null
/**
 * The current model takes tool additions as mid-conversation system messages (pi-ai compat
 * `supportsMidConvoToolAdditions`). Removing tools is not additive and makes pi resend the whole
 * tool list, so on such models switching browser control off keeps the declared tools (calls are
 * refused) and only removes the prompt section; the cached prefix survives.
 */
let keepToolsWhenOff = false

type ModelCtx = { model?: { compat?: { supportsMidConvoSystemMessages?: boolean; supportsMidConvoToolAdditions?: boolean } } }
export function noteModel(ctx: ModelCtx | undefined): void {
  const compat = ctx?.model?.compat
  keepToolsWhenOff = compat?.supportsMidConvoSystemMessages === true && compat?.supportsMidConvoToolAdditions === true
}

function apply(): void {
  if (!api) return
  try {
    const defer = canDefer(api)
    const current = api.getActiveTools()
    const declared = current.some((n) => BROWSER_TOOL_NAMES.includes(n))
    if (!enabled && keepToolsWhenOff && declared) return
    const mode = !defer ? 'all-direct' : enabled ? 'deferred' : 'hidden'
    if (mode !== registeredMode) {
      // Core tools keep one definition in every mode, so only the others are re-registered.
      registerTools(api, mode, true)
      registeredMode = mode
    }
    if (enabled && defer && !current.includes(TOOL_SEARCH)) addedToolSearch = true
    const next = nextActiveTools(current, enabled, defer)
    if (!enabled) addedToolSearch = false
    // Only touch the set when it changes: pi records the change and declares it from the next request.
    if (next.length === current.length && next.every((n, i) => n === current[i])) return
    api.setActiveTools(next)
  } catch {
    /* no session bound yet; session_start applies it */
  }
}

export function setBrowserToolsEnabled(on: boolean): void {
  enabled = on
  apply()
}

function callMain(tool: string, args: unknown, signal?: AbortSignal): Promise<ToolResultPayload> {
  const callId = `bt-${process.pid}-${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(callId)
      reject(new Error('browser_timeout: the browser did not answer in time'))
    }, CALL_TIMEOUT_MS)
    pending.set(callId, { resolve, reject, timer })
    signal?.addEventListener('abort', () => {
      const p = pending.get(callId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(callId)
      reject(new Error('aborted'))
    })
    sendToMain({ type: 'browser-tool-request', callId, tool, args })
  })
}

export async function handleBrowserToolResponse(msg: WorkerIncomingMessage, _reply: WorkerReply): Promise<void> {
  const p = pending.get(String(msg.callId ?? ''))
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(String(msg.callId))
  p.resolve((msg.result as ToolResultPayload) ?? { content: [{ type: 'text', text: 'browser_error: empty result' }], isError: true })
}

export const browserToolsExtension: InlineExtension = {
  name: 'pi-desktop-browser-tools',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    api = pi
    registeredMode = null
    // Registered inactive; session_start (when tool_search is known) picks the exposure.
    registerTools(pi, 'all-direct')
    registeredMode = 'all-direct'
    pi.on('session_start', (_event, ctx) => {
      noteModel(ctx as ModelCtx)
      apply()
    })
    pi.on('model_select', (_event, ctx) => noteModel(ctx as ModelCtx))
    pi.on('before_agent_start', (_event, ctx) => noteModel(ctx as ModelCtx))
  },
}
