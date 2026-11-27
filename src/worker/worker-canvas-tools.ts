// canvas_* tools (pi Desktop host capability "canvas"). Registered by a hidden inline extension,
// kept OUT of the active tool set unless the user switched the capability on for the session.

import type { ExtensionAPI, InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import type { WorkerReply } from './worker-handler-types.js'
import { sendToMain } from './worker-transport.js'
import { CANVAS_NAMESPACE, CANVAS_TOOL_DEFS, CANVAS_TOOL_NAMES } from '@shared/canvas-tools'

export { CANVAS_TOOL_NAMES }

const CALL_TIMEOUT_MS = 15_000

let api: ExtensionAPI | null = null
let enabled = false
let seq = 0

type ToolResultPayload = {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
}

const pending = new Map<
  string,
  { resolve: (r: ToolResultPayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
>()

let keepToolsWhenOff = false
type ModelCtx = {
  model?: { compat?: { supportsMidConvoSystemMessages?: boolean; supportsMidConvoToolAdditions?: boolean } }
}

function noteModel(ctx: ModelCtx | undefined): void {
  const compat = ctx?.model?.compat
  keepToolsWhenOff =
    compat?.supportsMidConvoSystemMessages === true && compat?.supportsMidConvoToolAdditions === true
}

function nextActiveCanvasTools(current: readonly string[], on: boolean): string[] {
  const rest = current.filter((n) => !CANVAS_TOOL_NAMES.includes(n))
  return on ? [...rest, ...CANVAS_TOOL_NAMES] : rest
}

function apply(): void {
  if (!api) return
  try {
    const current = api.getActiveTools()
    const declared = current.some((n) => CANVAS_TOOL_NAMES.includes(n))
    if (!enabled && keepToolsWhenOff && declared) return
    const next = nextActiveCanvasTools(current, enabled)
    if (next.length === current.length && next.every((n, i) => n === current[i])) return
    api.setActiveTools(next)
  } catch {
    /* session not bound yet; session_start applies it */
  }
}

export function setCanvasToolsEnabled(on: boolean): void {
  enabled = on
  apply()
}

function callMain(tool: string, args: unknown, signal?: AbortSignal): Promise<ToolResultPayload> {
  const callId = `cv-${process.pid}-${++seq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(callId)
      sendToMain({ type: 'canvas-tool-cancel', callId })
      reject(new Error('canvas_timeout: the desktop canvas did not answer in time'))
    }, CALL_TIMEOUT_MS)
    pending.set(callId, { resolve, reject, timer })
    signal?.addEventListener('abort', () => {
      const p = pending.get(callId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(callId)
      sendToMain({ type: 'canvas-tool-cancel', callId })
      reject(new Error('aborted'))
    })
    sendToMain({ type: 'canvas-tool-request', callId, tool, args })
  })
}

export async function handleCanvasToolResponse(msg: WorkerIncomingMessage, _reply: WorkerReply): Promise<void> {
  const callId = String(msg.callId ?? '')
  const p = pending.get(callId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(callId)
  p.resolve(
    (msg.result as ToolResultPayload) ?? {
      content: [{ type: 'text', text: 'canvas_error: empty result' }],
      isError: true,
    },
  )
}

export const canvasToolsExtension: InlineExtension = {
  name: 'pi-desktop-canvas-tools',
  hidden: true,
  factory: (pi: ExtensionAPI) => {
    api = pi
    for (const def of CANVAS_TOOL_DEFS) {
      pi.registerTool({
        name: def.name,
        label: def.label,
        description: def.description,
        parameters: def.parameters as unknown as ToolDefinition['parameters'],
        namespace: CANVAS_NAMESPACE,
        defaultActive: false,
        async execute(_toolCallId, params, signal) {
          if (!enabled) throw new Error('canvas_off: AI Canvas tool projection is switched off for this conversation')
          const result = await callMain(def.name, params, signal)
          if (result.isError) {
            throw new Error(result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n'))
          }
          return { content: result.content, details: {} }
        },
      })
    }
    pi.on('session_start', (_event, ctx) => {
      noteModel(ctx as ModelCtx)
      apply()
    })
    pi.on('model_select', (_event, ctx) => noteModel(ctx as ModelCtx))
    pi.on('before_agent_start', (_event, ctx) => noteModel(ctx as ModelCtx))
  },
}
