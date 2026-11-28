import { CANVAS_EVENT_CHANNEL, type CanvasToolCallEvent } from '@shared/canvas-types'
import { CANVAS_TOOL_NAMES } from '@shared/canvas-tools'
import { getMainWindow } from '../window'

export interface CanvasToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
}

const CALL_TIMEOUT_MS = 12_000

const pending = new Map<
  string,
  {
    resolve: (result: CanvasToolResult) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

const fail = (text: string): CanvasToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
})

export function resolveCanvasToolFromRenderer(callId: string, result: CanvasToolResult): void {
  const entry = pending.get(callId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(callId)
  entry.resolve(result)
}

export function cancelCanvasToolRequest(callId: string): void {
  const entry = pending.get(callId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(callId)
  entry.resolve(fail('canvas_aborted: request cancelled'))
}

export async function handleCanvasToolRequest(
  data: Record<string, unknown>,
  slot: { cwd: string; sessionFile?: string | null; poolKey: string },
  post: (message: Record<string, unknown>) => void,
): Promise<void> {
  const callId = String(data.callId ?? '')
  if (!callId) return
  const tool = String(data.tool ?? '')
  if (!CANVAS_TOOL_NAMES.includes(tool)) {
    post({ type: 'canvas-tool-response', callId, result: fail(`canvas_unknown_tool: ${tool}`) })
    return
  }

  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    post({ type: 'canvas-tool-response', callId, result: fail('canvas_unavailable: desktop window is closed') })
    return
  }

  const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args)
    ? (data.args as Record<string, unknown>)
    : {}

  const event: CanvasToolCallEvent = {
    type: 'canvas-tool-call',
    callId,
    tool,
    args,
    sessionFile: slot.sessionFile ?? null,
    cwd: slot.cwd || null,
  }

  const result = await new Promise<CanvasToolResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(callId)
      resolve(fail('canvas_timeout: renderer did not respond'))
    }, CALL_TIMEOUT_MS)
    pending.set(callId, { resolve, timer })
    win.webContents.send(CANVAS_EVENT_CHANNEL, event)
  })

  post({ type: 'canvas-tool-response', callId, result })
}
