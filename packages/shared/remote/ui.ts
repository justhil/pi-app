import { z } from 'zod'

/**
 * Extension UI requests forwarded to remote clients. Mirrors `ExtensionUIRequest`
 * (src/worker/desktop-ui-bridge.ts) plus the routing key; answers use the same
 * response shape the desktop sends to `extension.respondUI`.
 */

const base = { id: z.string(), sessionKey: z.string(), timeout: z.number().positive().optional() }

export const UiQuestionSchema = z
  .object({
    question: z.string(),
    header: z.string().optional(),
    multiSelect: z.boolean().optional(),
    options: z.array(
      z
        .object({
          label: z.string(),
          description: z.string().optional(),
          hasPreview: z.boolean().optional(),
          preview: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict()
export type UiQuestion = z.infer<typeof UiQuestionSchema>

export const UiRequestSchema = z.union([
  z.object({ ...base, method: z.literal('select'), title: z.string(), options: z.array(z.string()) }).strict(),
  z.object({ ...base, method: z.literal('confirm'), title: z.string(), message: z.string() }).strict(),
  z.object({ ...base, method: z.literal('input'), title: z.string(), placeholder: z.string().optional() }).strict(),
  z.object({ ...base, method: z.literal('editor'), title: z.string(), prefill: z.string().optional() }).strict(),
  z
    .object({ ...base, method: z.literal('notify'), message: z.string(), notifyType: z.enum(['info', 'warning', 'error']).optional() })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal('custom'),
      kind: z.literal('ask_user_question'),
      questions: z.array(UiQuestionSchema),
      toolCallId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      method: z.literal('custom'),
      kind: z.literal('image_review'),
      image: z.string(),
      title: z.string(),
      question: z.string(),
      context: z.string().optional(),
      options: z.array(z.string()),
      allowFeedback: z.boolean(),
    })
    .strict(),
])
export type UiRequest = z.infer<typeof UiRequestSchema>

/** Same fields as the desktop `extension.respondUI` payload, minus routing. */
export const UiResponseSchema = z
  .object({
    id: z.string(),
    value: z.string().optional(),
    confirmed: z.boolean().optional(),
    cancelled: z.boolean().optional(),
    result: z.unknown().optional(),
  })
  .strict()
export type UiResponse = z.infer<typeof UiResponseSchema>

export const UiDismissSchema = z
  .object({ id: z.string(), sessionKey: z.string(), by: z.enum(['desktop', 'remote', 'system']) })
  .strict()
export type UiDismiss = z.infer<typeof UiDismissSchema>
