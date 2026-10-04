// browser_* tools (pi Desktop host capability "browser"). Registered by a hidden inline extension,
// kept OUT of the active tool set unless the user switched the capability on for the session.
// Execution happens in Main (BrowserHost); the worker only forwards calls. See
// docs/architecture/adr/ADR-desktop-host-tools.md.

import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { sendToMain } from './worker-transport.js'
import { BROWSER_TOOL_DEFS, BROWSER_TOOL_NAMES, leanSchema } from '@shared/browser-tools'

export { BROWSER_TOOL_NAMES }
const CALL_TIMEOUT_MS = 90_000

let api: ExtensionAPI | null = null
let enabled = false
let seq = 0
const pending = new Map<string, { resolve: (r: ToolResultPayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

type ToolResultPayload = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean }

/** Desired active set: current tools without browser_*, plus browser_* when enabled. */
export function nextActiveTools(current: readonly string[], on: boolean): string[] {
  const rest = current.filter((n) => !BROWSER_TOOL_NAMES.includes(n))
  return on ? [...rest, ...BROWSER_TOOL_NAMES] : rest
}

function apply(): void {
  if (!api) return
  try {
    const current = api.getActiveTools()
    const next = nextActiveTools(current, enabled)
    // Only touch the set when it changes: every change rebuilds the system prompt (cache miss).
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
    for (const def of BROWSER_TOOL_DEFS) {
      pi.registerTool({
        name: def.name,
        label: def.label,
        description: def.description,
        // Plain JSON Schema: pi validates non-TypeBox schemas with its JSON Schema path.
        parameters: leanSchema(def.parameters) as unknown as ToolDefinition['parameters'],
        async execute(_toolCallId, params, signal) {
          const result = await callMain(def.name, params, signal)
          if (result.isError) throw new Error(result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'))
          return { content: result.content, details: {} }
        },
      })
    }
    pi.on('session_start', () => apply())
  },
}
