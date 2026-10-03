// browser_* tools (pi Desktop host capability "browser"). Registered by a hidden inline extension,
// kept OUT of the active tool set unless the user switched the capability on for the session.
// Execution happens in Main (BrowserHost); the worker only forwards calls. See
// docs/architecture/adr/ADR-desktop-host-tools.md.

import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { sendToMain } from './worker-transport.js'

type JsonSchema = Record<string, unknown>
const tabId: JsonSchema = { type: 'string', description: 'Tab id from browser_tabs; defaults to the tab shown in the panel.' }
const ref: JsonSchema = { type: 'string', description: 'Element ref such as e12 from the latest browser_snapshot.' }
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const DEFS: { name: string; label: string; description: string; parameters: JsonSchema }[] = [
  {
    name: 'browser_tabs',
    label: 'Browser tabs',
    description: 'List, open (http/https), close or focus tabs of the built-in browser that the user can see. New tabs open in the background.',
    parameters: obj({ action: { type: 'string', enum: ['list', 'new', 'close', 'focus'] }, tabId, url: { type: 'string' } }, ['action']),
  },
  {
    name: 'browser_navigate',
    label: 'Browser navigate',
    description: 'Go to an http(s) URL in a tab, or move back/forward/reload. Waits for the page to load.',
    parameters: obj({ tabId, url: { type: 'string' }, history: { type: 'string', enum: ['back', 'forward', 'reload'] } }),
  },
  {
    name: 'browser_snapshot',
    label: 'Browser snapshot',
    description: 'Read the page as an outline of roles, names and text. Interactive elements carry refs (e.g. [ref=e12]) for browser_act. Main frame only; pass scope=<ref> to read one region.',
    parameters: obj({ tabId, scope: ref, maxChars: { type: 'integer', minimum: 2000, maximum: 120000 } }),
  },
  {
    name: 'browser_screenshot',
    label: 'Browser screenshot',
    description: 'PNG of the visible part of the page, for layout or visual checks the outline cannot show.',
    parameters: obj({ tabId }),
  },
  {
    name: 'browser_act',
    label: 'Browser act',
    description:
      'Act on the page with real input: click/dblclick/rightclick/hover/fill/type/press/select/scroll/drag/upload. fill replaces a field value; type appends; press takes key like "Enter" or "Control+A"; upload takes workspace-relative files.',
    parameters: obj(
      {
        tabId,
        action: { type: 'string', enum: ['click', 'dblclick', 'rightclick', 'hover', 'fill', 'type', 'press', 'select', 'scroll', 'drag', 'upload'] },
        ref,
        value: { type: 'string', description: 'Text for fill/type, option value or label for select.' },
        key: { type: 'string' },
        deltaY: { type: 'number', description: 'Scroll amount in px (positive = down).' },
        targetRef: { type: 'string', description: 'Drop target ref for drag.' },
        files: { type: 'array', items: { type: 'string' } },
      },
      ['action'],
    ),
  },
  {
    name: 'browser_wait',
    label: 'Browser wait',
    description: 'Wait until the page shows some text or its URL contains a fragment (exactly one), up to 30 s.',
    parameters: obj({ tabId, text: { type: 'string' }, url: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 100, maximum: 30000 } }),
  },
  {
    name: 'browser_logs',
    label: 'Browser logs',
    description: 'Recent console errors/warnings and failed or >=400 network requests of a tab.',
    parameters: obj({ tabId, max: { type: 'integer', minimum: 1, maximum: 200 } }),
  },
  {
    name: 'browser_eval',
    label: 'Browser eval',
    description: 'Run a JS function in an isolated world (sees the DOM, not page variables). With ref, the element is its first argument. Returns JSON.',
    parameters: obj({ tabId, function: { type: 'string', description: 'e.g. "(el) => el.textContent"' }, ref }, ['function']),
  },
]

export const BROWSER_TOOL_NAMES = DEFS.map((d) => d.name)
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
    for (const def of DEFS) {
      pi.registerTool({
        name: def.name,
        label: def.label,
        description: def.description,
        // Plain JSON Schema: pi validates non-TypeBox schemas with its JSON Schema path.
        parameters: def.parameters as unknown as ToolDefinition['parameters'],
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
