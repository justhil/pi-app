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
