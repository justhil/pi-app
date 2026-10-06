import { z } from 'zod'

/**
 * Turn-centric timeline model sent to remote clients. The gateway projects pi events and
 * session history into these shapes; clients only render them (no business derivation).
 * Text fields hold raw markdown: clients split blocks (code / pi-ui / html / math) themselves,
 * so streaming only ever appends to a string.
 */

const count = z.number().int().nonnegative()

export const ActivityCountsSchema = z
  .object({ read: count, edit: count, write: count, run: count, search: count, think: count, other: count })
  .strict()
export type ActivityCounts = z.infer<typeof ActivityCountsSchema>

export const emptyActivityCounts = (): ActivityCounts => ({ read: 0, edit: 0, write: 0, run: 0, search: 0, think: 0, other: 0 })

export const StepStatusSchema = z.enum(['running', 'ok', 'error'])
export type StepStatus = z.infer<typeof StepStatusSchema>

/** Built-in tool templates plus the adapter `toolCard` templates a client may render natively. */
export const RENDER_TEMPLATES = ['bash', 'read', 'edit', 'write', 'search', 'default', 'list', 'kv', 'media', 'tree'] as const

export const RenderNodeSchema = z
  .object({
    template: z.string().min(1),
    title: z.string(),
    icon: z.string().optional(),
    status: StepStatusSchema,
    /** Template fields, already resolved (adapter JSONPath evaluated on the desktop). */
    fields: z.record(z.unknown()),
    /** Truncated output / diff shown inline. */
    preview: z.string().optional(),
    /** True when more content is available via `turn.toolDetail`. */
    detail: z.boolean().optional(),
    /** One-line plain text used when the client cannot render `template`. */
    fallbackText: z.string(),
  })
  .strict()
export type RenderNode = z.infer<typeof RenderNodeSchema>

export const ThinkingStepSchema = z
  .object({ id: z.string(), kind: z.literal('thinking'), text: z.string(), ms: z.number().nonnegative().optional() })
  .strict()
export const ToolStepSchema = z
  .object({
    id: z.string(),
    kind: z.literal('tool'),
    toolCallId: z.string(),
    toolName: z.string(),
    category: z.enum(['read', 'edit', 'write', 'run', 'search', 'other']),
    node: RenderNodeSchema,
    status: StepStatusSchema,
    ms: z.number().nonnegative().optional(),
  })
  .strict()
export const ProseStepSchema = z.object({ id: z.string(), kind: z.literal('prose'), text: z.string() }).strict()

export const StepSchema = z.discriminatedUnion('kind', [ThinkingStepSchema, ToolStepSchema, ProseStepSchema])
export type Step = z.infer<typeof StepSchema>
export type ToolStep = z.infer<typeof ToolStepSchema>

export const FileStatSchema = z.object({ path: z.string(), add: count, del: count }).strict()
export type FileStat = z.infer<typeof FileStatSchema>

export const TurnStatusSchema = z.enum(['running', 'done', 'failed', 'aborted'])
export type TurnStatus = z.infer<typeof TurnStatusSchema>

export const TurnSchema = z
  .object({
    id: z.string(),
    /** Stable paging anchor: the user message's session entry id, or `live:<id>` before it is saved. */
    anchor: z.string(),
    status: TurnStatusSchema,
    startedAt: z.number().optional(),
    durationMs: z.number().nonnegative().optional(),
    user: z.object({ text: z.string(), images: count.optional() }).strict(),
    activity: z
      .object({
        counts: ActivityCountsSchema,
        failed: count,
        thinkingMs: z.number().nonnegative().optional(),
        /** Id of the step currently running (live turns only). */
        live: z.string().optional(),
      })
      .strict(),
    steps: z.array(StepSchema),
    /** Assistant text after the last tool call — the turn's answer. */
    answer: z.string(),
    files: z.array(FileStatSchema),
    meta: z.object({ model: z.string().optional(), thinking: z.string().optional() }).strict().optional(),
    error: z.object({ kind: z.enum(['error', 'aborted', 'retry']), text: z.string() }).strict().optional(),
  })
  .strict()
export type Turn = z.infer<typeof TurnSchema>

/** The session's todo list (desktop adapter widget `todo-list-v1`, shown above the composer). */
export const TodoStateSchema = z
  .object({
    title: z.string(),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            text: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
            priority: z.enum(['high', 'medium', 'low']).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
export type TodoState = z.infer<typeof TodoStateSchema>

export const SessionStateSchema = z
  .object({
    running: z.boolean(),
    model: z.string().optional(),
    thinking: z.string().optional(),
    availableThinking: z.array(z.string()).optional(),
    queue: z.object({ steering: z.array(z.string()), followUp: z.array(z.string()) }).strict().optional(),
    /** null = the list was cleared. */
    todo: TodoStateSchema.nullable().optional(),
  })
  .strict()
export type SessionState = z.infer<typeof SessionStateSchema>

const seq = z.number().int().nonnegative()

export const TurnPatchSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('turn.upsert'), seq, turn: TurnSchema }).strict(),
  z.object({ op: z.literal('step.upsert'), seq, turnId: z.string(), step: StepSchema, counts: ActivityCountsSchema, failed: count, live: z.string().optional() }).strict(),
  /** Coalesced appends keep the first seq and cover through `seqTo`. */
  z.object({ op: z.literal('text.append'), seq, seqTo: seq.optional(), turnId: z.string(), ref: z.string(), delta: z.string() }).strict(),
  z.object({ op: z.literal('turn.promote'), seq, turnId: z.string(), step: ProseStepSchema }).strict(),
  z
    .object({
      op: z.literal('turn.settle'),
      seq,
      turnId: z.string(),
      status: TurnStatusSchema,
      durationMs: z.number().nonnegative().optional(),
      files: z.array(FileStatSchema),
      error: TurnSchema.shape.error,
    })
    .strict(),
  z.object({ op: z.literal('session.state'), seq, state: SessionStateSchema }).strict(),
  /** The session's branch changed (rewind): drop the timeline and open it again for a fresh snapshot. */
  z.object({ op: z.literal('timeline.reset'), seq }).strict(),
])
export type TurnPatch = z.infer<typeof TurnPatchSchema>

export const SessionStatusSchema = z.enum(['idle', 'running', 'needsInput', 'failed'])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionSummarySchema = z
  .object({
    sessionKey: z.string(),
    projectId: z.string(),
    title: z.string(),
    status: SessionStatusSchema,
    updatedAt: z.number(),
    /** Last answer line, pending question, or failure text. */
    preview: z.string().optional(),
    /** Running sessions: the step in progress, e.g. "npm run lint". */
    live: z.string().optional(),
    liveCategory: ToolStepSchema.shape.category.optional(),
    startedAt: z.number().optional(),
    counts: ActivityCountsSchema.optional(),
    filesChanged: count.optional(),
  })
  .strict()
export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const CursorSchema = z.object({ epoch: z.string(), seq }).strict()
export type Cursor = z.infer<typeof CursorSchema>

/** `temporary`: a desktop temporary chat (sandbox folder); `name` is then its title, not the folder id. */
export const ProjectInfoSchema = z.object({ id: z.string(), name: z.string(), temporary: z.boolean().optional() }).strict()
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>
