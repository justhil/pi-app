import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { resolveCanvasToolFromRenderer } from '../../canvas/canvas-tool-bridge'

const toolResponseSchema = z.object({
  callId: z.string().min(1).max(128),
  isError: z.boolean().optional(),
  content: z
    .array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
      ]),
    )
    .min(1),
})

export function registerCanvasHandlers(): void {
  registerHandlerWithSchema('ipc:canvas.toolResponse', toolResponseSchema, async (req) => {
    resolveCanvasToolFromRenderer(req.callId, {
      content: req.content,
      isError: req.isError,
    })
    return { ok: true }
  })
}
