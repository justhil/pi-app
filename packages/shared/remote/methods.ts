import { z } from 'zod'
import {
  CursorSchema,
  ProjectInfoSchema,
  RenderNodeSchema,
  SessionStateSchema,
  SessionSummarySchema,
  TurnPatchSchema,
  TurnSchema,
} from './timeline'
import { UiRequestSchema, UiResponseSchema } from './ui'

/** RPC table: method name → params / result schema and the minimum device role. */

export const RoleSchema = z.enum(['viewer', 'operator'])
export type Role = z.infer<typeof RoleSchema>

export const CACHE_WARMING_MODES = ['off', 'streaming', 'idle'] as const
export const CacheWarmingSchema = z.enum(CACHE_WARMING_MODES)
export type CacheWarming = z.infer<typeof CacheWarmingSchema>

export const SEND_MODES = ['prompt', 'steer', 'followUp'] as const

/** Raw attachment bytes per upload (phones downscale photos well below this). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const empty = z.object({}).strict()
const sessionKey = z.string().min(1)

export const AssetInfoSchema = z.object({ name: z.string(), sha256: z.string(), size: z.number().int().nonnegative() }).strict()

export const HelloParamsSchema = z
  .object({
    app: z.object({ name: z.string(), version: z.string(), platform: z.string() }).strict(),
    caps: z
      .object({
        templates: z.array(z.string()),
        piUi: z.array(z.string()),
        uiKinds: z.array(z.string()),
      })
      .strict(),
  })
  .strict()

export const HelloResultSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    version: z.string(),
    epoch: z.string(),
    deviceId: z.string(),
    role: RoleSchema,
    features: z.array(z.string()),
    assets: z.array(AssetInfoSchema),
    /** Current LAN endpoints, so a paired phone follows DHCP changes without scanning again. */
    endpoints: z.array(z.string()).max(16).optional(),
  })
  .strict()

export const OpenResultSchema = z
  .object({
    sessionKey,
    title: z.string(),
    epoch: z.string(),
    seq: z.number().int().nonnegative(),
    kind: z.enum(['snapshot', 'replay']),
    resync: z.enum(['epoch_changed', 'gap', 'evicted']).optional(),
    turns: z.array(TurnSchema).optional(),
    hasOlder: z.boolean().optional(),
    patches: z.array(TurnPatchSchema).optional(),
    state: SessionStateSchema,
    pendingUi: z.array(UiRequestSchema),
  })
  .strict()
export type OpenResult = z.infer<typeof OpenResultSchema>

/** `group`: custom = models.json, apiKey = other key-based auth, login = OAuth sign-in; the phone lists them in that order. */
export const MODEL_GROUPS = ['custom', 'apiKey', 'login'] as const
export const ModelInfoSchema = z
  .object({ id: z.string(), name: z.string().optional(), provider: z.string().optional(), group: z.enum(MODEL_GROUPS).optional() })
  .strict()

export const CapabilityRowSchema = z
  .object({
    id: z.string(),
    available: z.boolean(),
    reason: z.string().optional(),
    promptTokens: z.number().int().nonnegative(),
    tools: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .strict()

export const COMMAND_CATEGORIES = ['prompt', 'skill', 'extension'] as const
/** A slash command pi expands when it is sent as prompt text (`/name args`). */
export const CommandInfoSchema = z
  .object({ name: z.string(), description: z.string().max(400).optional(), category: z.enum(COMMAND_CATEGORIES) })
  .strict()
export type CommandInfo = z.infer<typeof CommandInfoSchema>

/** A file or folder in the session's project; `path` is relative to the project root, `/`-separated. */
export const FileEntrySchema = z
  .object({ name: z.string(), path: z.string(), dir: z.boolean(), size: z.number().int().nonnegative().optional(), mtime: z.number().int().optional() })
  .strict()
export type FileEntry = z.infer<typeof FileEntrySchema>

/** One branch of a session's tree (a tip holding user messages). */
export const BranchInfoSchema = z
  .object({
    leafId: z.string(),
    /** The branch's last user message (preview). */
    title: z.string(),
    turns: z.number().int().nonnegative(),
    current: z.boolean(),
    updatedAt: z.number().int().optional(),
    /** Its first user message after it split from the current branch. */
    divergedAt: z.string().optional(),
    /** The branch's last assistant reply (preview), to tell apart branches with the same prompt. */
    reply: z.string().optional(),
  })
  .strict()
export type BranchInfo = z.infer<typeof BranchInfoSchema>

const nn = z.number().int().nonnegative()

/** Tokens and cost of every reply in the session file (cost in USD from the model entries' prices). */
export const SessionUsageSchema = z
  .object({ input: nn, output: nn, cacheRead: nn, cacheWrite: nn, cost: z.number().nonnegative(), calls: nn })
  .strict()
export type SessionUsage = z.infer<typeof SessionUsageSchema>

/** One rendered diff line: context, added, removed, or a gap between hunks. `o`/`n` are old/new line numbers. */
export const DiffLineSchema = z
  .object({ k: z.enum(['ctx', 'add', 'del', 'gap']), o: z.number().int().positive().optional(), n: z.number().int().positive().optional(), s: z.string() })
  .strict()
export type DiffLine = z.infer<typeof DiffLineSchema>

export const DiffFileSchema = z
  .object({ path: z.string(), add: z.number().int().nonnegative(), del: z.number().int().nonnegative(), status: z.enum(['modified', 'added', 'deleted', 'renamed', 'binary']) })
  .strict()
export type DiffFile = z.infer<typeof DiffFileSchema>

/** What the session's context holds right now (desktop composer metrics): chars / 4 like the desktop. */
export const ContextStatsSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    /** The model's context window; absent when the model is unknown. */
    window: z.number().int().positive().optional(),
    messages: z.number().int().nonnegative(),
    breakdown: z.array(z.object({ role: z.string(), tokens: z.number().int().nonnegative() }).strict()).max(12),
  })
  .strict()
export type ContextStats = z.infer<typeof ContextStatsSchema>

function method<P extends z.ZodTypeAny, R extends z.ZodTypeAny>(params: P, result: R, role: Role) {
  return { params, result, role }
}

export const REMOTE_METHODS = {
  'host.hello': method(HelloParamsSchema, HelloResultSchema, 'viewer'),
  'project.list': method(empty, z.object({ projects: z.array(ProjectInfoSchema) }).strict(), 'viewer'),
  'session.watchList': method(
    z.object({ projectId: z.string().optional() }).strict(),
    z.object({ sessions: z.array(SessionSummarySchema) }).strict(),
    'viewer',
  ),
  'session.unwatchList': method(empty, empty, 'viewer'),
  'session.open': method(z.object({ sessionKey, cursor: CursorSchema.optional() }).strict(), OpenResultSchema, 'viewer'),
  'session.close': method(z.object({ sessionKey }).strict(), empty, 'viewer'),
  'turn.page': method(
    z.object({ sessionKey, before: z.string(), limit: z.number().int().min(1).max(50) }).strict(),
    z.object({ turns: z.array(TurnSchema), hasOlder: z.boolean() }).strict(),
    'viewer',
  ),
  'turn.toolDetail': method(
    z.object({ sessionKey, toolCallId: z.string() }).strict(),
    z.object({ node: RenderNodeSchema, output: z.string().optional() }).strict(),
    'viewer',
  ),
  'turn.send': method(
    z
      .object({ sessionKey, text: z.string().min(1).max(100_000), mode: z.enum(SEND_MODES), clientMessageId: z.string().min(8).max(80) })
      .strict(),
    z.object({ accepted: z.literal(true), duplicate: z.boolean().optional() }).strict(),
    'operator',
  ),
  /** Stop the run. Queued steer/follow-up texts are pulled back (`restored`) so the phone can put them in its composer. */
  'turn.abort': method(
    z.object({ sessionKey }).strict(),
    z.object({ aborted: z.boolean(), restored: z.array(z.string()).optional() }).strict(),
    'operator',
  ),
  /**
   * Rewind to just before a user message (pi `navigateTree` on its entry): later turns leave the
   * active branch and the message text comes back as `editorText` for editing. Refused while running.
   */
  'turn.rewind': method(
    z.object({ sessionKey, anchor: z.string().min(1) }).strict(),
    z.object({ editorText: z.string().optional() }).strict(),
    'operator',
  ),
  /** The session's branches (rewinds and edits leave the old turns on another branch). */
  'session.branches': method(z.object({ sessionKey }).strict(), z.object({ branches: z.array(BranchInfoSchema) }).strict(), 'viewer'),
  /** Make another branch the active one (pi `navigateTree` to its last entry). Refused while running. */
  'session.switchBranch': method(z.object({ sessionKey, leafId: z.string().min(1) }).strict(), z.object({}).strict(), 'operator'),
  /**
   * New session with the history before the user message `anchor` (desktop fork); the message
   * text comes back as `editorText`. Refused while running.
   */
  'session.fork': method(
    z.object({ sessionKey, anchor: z.string().min(1) }).strict(),
    z.object({ sessionKey, editorText: z.string().optional() }).strict(),
    'operator',
  ),
  /** Pull queued steer/follow-up texts back without stopping the run. */
  'turn.dequeue': method(z.object({ sessionKey }).strict(), z.object({ restored: z.array(z.string()) }).strict(), 'operator'),
  'session.create': method(
    z.object({ projectId: z.string(), capabilities: z.array(z.string()).optional() }).strict(),
    z.object({ sessionKey }).strict(),
    'operator',
  ),
  'model.list': method(
    z.object({ sessionKey }).strict(),
    z
      .object({
        models: z.array(ModelInfoSchema),
        current: z.string().optional(),
        thinking: z.string().optional(),
        availableThinking: z.array(z.string()),
      })
      .strict(),
    'viewer',
  ),
  'model.set': method(z.object({ sessionKey, modelId: z.string() }).strict(), z.object({ model: z.string() }).strict(), 'operator'),
  'attachment.upload': method(
    z
      .object({
        name: z.string().min(1).max(200),
        mime: z.string().max(100),
        /** base64 of the file bytes */
        data: z.string().min(1).max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4),
      })
      .strict(),
    /** `path` is a host file the prompt text references, exactly like a desktop clipboard image. */
    z.object({ path: z.string(), name: z.string(), size: z.number().int().nonnegative() }).strict(),
    'operator',
  ),
  /** Read back an attachment (phone uploads or desktop pastes) — only `pi-clipboard-*` files in the attachment dir. */
  'attachment.get': method(
    z.object({ path: z.string().min(1).max(4096) }).strict(),
    z.object({ mime: z.string(), data: z.string() }).strict(),
    'viewer',
  ),
  'thinking.set': method(z.object({ sessionKey, level: z.string() }).strict(), z.object({ level: z.string() }).strict(), 'operator'),
  /** Slash commands available in the session's project (prompts, skills the desktop has enabled, extension commands). */
  /** Context usage for the session panel; null when the host cannot read it. */
  'session.stats': method(
    z.object({ sessionKey }).strict(),
    z.object({ context: ContextStatsSchema.nullable(), usage: SessionUsageSchema.nullable().optional() }).strict(),
    'viewer',
  ),
  'command.list': method(z.object({ sessionKey }).strict(), z.object({ commands: z.array(CommandInfoSchema) }).strict(), 'viewer'),
  /**
   * Changes to review: `git` = the project's working tree against HEAD (incl. untracked text files),
   * `turn` = what one turn's edit / write calls changed. Without `path` only the file list comes
   * back; with it, that file's lines (capped, `truncated` when cut).
   */
  'review.diff': method(
    z.object({ sessionKey, scope: z.enum(['git', 'turn']), turnId: z.string().optional(), path: z.string().max(4096).optional() }).strict(),
    z
      .object({
        isRepo: z.boolean(),
        branch: z.string().optional(),
        files: z.array(DiffFileSchema),
        file: z.object({ path: z.string(), lines: z.array(DiffLineSchema), truncated: z.boolean() }).strict().optional(),
        message: z.string().optional(),
      })
      .strict(),
    'viewer',
  ),
  /** One folder of the session's project (folders first). Paths outside the project are refused. */
  'file.list': method(
    z.object({ sessionKey, path: z.string().max(4096), dotfiles: z.boolean().optional() }).strict(),
    z.object({ entries: z.array(FileEntrySchema), truncated: z.boolean() }).strict(),
    'viewer',
  ),
  /** Fuzzy path search across the project (desktop `@` search). */
  'file.search': method(
    z.object({ sessionKey, query: z.string().max(512) }).strict(),
    z.object({ entries: z.array(FileEntrySchema) }).strict(),
    'viewer',
  ),
  'capability.list': method(z.object({ sessionKey }).strict(), z.object({ capabilities: z.array(CapabilityRowSchema) }).strict(), 'viewer'),
  'capability.set': method(
    z.object({ sessionKey, id: z.string(), on: z.boolean() }).strict(),
    z.object({ enabled: z.array(z.string()) }).strict(),
    'operator',
  ),
  'settings.cacheWarming.get': method(empty, z.object({ mode: CacheWarmingSchema }).strict(), 'viewer'),
  'settings.cacheWarming.set': method(z.object({ mode: CacheWarmingSchema }).strict(), z.object({ mode: CacheWarmingSchema }).strict(), 'operator'),
  'ui.respond': method(UiResponseSchema, z.object({ accepted: z.boolean() }).strict(), 'operator'),
  'ui.cancel': method(z.object({ id: z.string() }).strict(), z.object({ accepted: z.boolean() }).strict(), 'operator'),
} as const

export type RemoteMethod = keyof typeof REMOTE_METHODS
export type MethodParams<M extends RemoteMethod> = z.infer<(typeof REMOTE_METHODS)[M]['params']>
export type MethodResult<M extends RemoteMethod> = z.infer<(typeof REMOTE_METHODS)[M]['result']>

export const isRemoteMethod = (m: string): m is RemoteMethod => Object.prototype.hasOwnProperty.call(REMOTE_METHODS, m)

/** Viewer < operator. */
export const roleAllows = (have: Role, need: Role): boolean => have === 'operator' || need === 'viewer'
