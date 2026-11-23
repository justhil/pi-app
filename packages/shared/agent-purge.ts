import {
  BUILTIN_AGENT_PURGE_PERSONAS,
  type BuiltinPurgePersonaSeed,
  type LocalizedPersonaCopy,
  type PersonaUiLanguage,
  type PurgePrimerTurn,
} from './agent-purge-presets.ts'
import { normalizeSessionFileKey } from './session-file-key.ts'

export type { LocalizedPersonaCopy, PersonaUiLanguage, PurgePrimerTurn } from './agent-purge-presets.ts'

export const AGENT_PURGE_MODES = ['replace', 'append', 'strict'] as const
export type AgentPurgeMode = (typeof AGENT_PURGE_MODES)[number]

export const PURGE_HISTORY_MODES = ['none', 'push', 'tunnel'] as const
export type PurgeHistoryMode = (typeof PURGE_HISTORY_MODES)[number]

export const PURGE_THINKING_GUIDANCES = ['anchor', 'tool_cot', 'suppress', 'off'] as const
export type PurgeThinkingGuidance = (typeof PURGE_THINKING_GUIDANCES)[number]

export const PURGE_CIPHER_LEVELS = ['off', 'minimal', 'full'] as const
export type PurgeCipherLevel = (typeof PURGE_CIPHER_LEVELS)[number]

export const PURGE_STRATEGY_PRESETS = ['standard', 'relay_push', 'tunnel', 'custom'] as const
export type PurgeStrategyPresetId = (typeof PURGE_STRATEGY_PRESETS)[number]

export interface PurgeStrategyOptions {
  /** Inject persona's static `primerTurns` right after system prompt (cache-safe static prefix). */
  primerEnabled: boolean
  /** Scrub prior soft-refusal assistant turns and compaction safety clauses in memory before send. */
  scrubHistory: boolean
  /** Chain-of-thought steering mode: anchor | tool_cot | suppress | off. */
  thinkingGuidance: PurgeThinkingGuidance
  /** Synthetic conversation history wrapping mode: none | push (tail ack) | tunnel (full tool chain). */
  historyMode: PurgeHistoryMode
  /** Emit full assistant text via virtual tool (`purge_reply`) and stream-unwrap back to prose. */
  toolOutputRelay: boolean
  /** Lossless red-line lexicon tier: off | minimal (latest user only) | full (all history, breaks cache). */
  cipherLevel: PurgeCipherLevel
  /** Intercept policy error / empty output / soft refusal and run 1 escalated retry automatically. */
  autoRetry: boolean
}

export const DEFAULT_PURGE_STRATEGY: Readonly<PurgeStrategyOptions> = Object.freeze({
  primerEnabled: true,
  scrubHistory: true,
  thinkingGuidance: 'anchor',
  historyMode: 'none',
  toolOutputRelay: false,
  cipherLevel: 'off',
  autoRetry: true,
})

export interface AgentPurgePersona {
  id: string
  name: string
  description: string
  body: string
  primerTurns?: PurgePrimerTurn[]
  builtin?: boolean
  order?: number
  updatedAt?: number
  /** Localized display copy, prompt body, and optional primer turns, keyed by app language. */
  i18n?: Partial<Record<PersonaUiLanguage, LocalizedPersonaCopy>>
}

export interface AgentPurgeConfig {
  defaultPersonaId: string
  defaultMode: AgentPurgeMode
  defaultStrategy: PurgeStrategyOptions
  /** Optional `provider/modelId` fallback used on escalated retry when primary model still blocks. */
  retryFallbackModel?: string
  /** User-defined lexicon rules (`原词=~同音词` or `原词=客观描述`). */
  customTerms: string[]
  personas: AgentPurgePersona[]
}

export interface PurgedSessionRecord {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
  body: string
  primerTurns?: PurgePrimerTurn[]
  strategy: PurgeStrategyOptions
  lockedAt: number
}

export interface ActivePurgePayload {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
  body: string
  primerTurns?: PurgePrimerTurn[]
  strategy: PurgeStrategyOptions
  retryFallbackModel?: string
  customTerms?: string[]
}

/**
 * Cache impact classification for both static option badges and mid-session mutation warnings.
 * - `none`          : Does not invalidate existing prefix KV cache.
 * - `tail_1_turn`   : Appends transient tail turn per send; prior history prefix caches normally,
 *                     only the latest turn does not enter next turn's static prefix.
 * - `breaks_prefix` : Rewrites system prompt, tool declarations, or historical prefix messages,
 *                     invalidating the current session's cached KV prefix on the next send.
 */
export type PurgeCacheImpactKind = 'none' | 'tail_1_turn' | 'breaks_prefix'

export type PurgeMidSessionImpactReason =
  | 'toggle_enable'
  | 'toggle_disable'
  | 'switch_persona'
  | 'switch_mode'
  | 'toggle_primer'
  | 'switch_thinking_guidance'
  | 'switch_tunnel'
  | 'toggle_relay'
  | 'switch_cipher_full'
  | 'switch_push'

export interface PurgeCacheImpactAssessment {
  kind: PurgeCacheImpactKind
  reasons: PurgeMidSessionImpactReason[]
}

const RESERVED_IDS = new Set(['active', '.active'])

export function isValidPurgePersonaId(id: string): boolean {
  const s = String(id ?? '').trim()
  return (
    Boolean(s) &&
    s.length <= 64 &&
    !s.includes('..') &&
    !/[\\/:*?"<>|\0]/.test(s) &&
    !RESERVED_IDS.has(s.toLowerCase())
  )
}

export function sanitizePurgePersonaId(rawId: string, fallbackName = 'persona'): string {
  let s = String(rawId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!s || RESERVED_IDS.has(s)) {
    const fb = String(fallbackName || 'persona')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    s = fb && !RESERVED_IDS.has(fb) ? fb : `p-${Date.now().toString(36)}`
  }
  return s.slice(0, 64)
}

export function normalizePurgeMode(raw: unknown, fallback: AgentPurgeMode = 'replace'): AgentPurgeMode {
  return (AGENT_PURGE_MODES as readonly unknown[]).includes(raw) ? (raw as AgentPurgeMode) : fallback
}

export function normalizePurgeHistoryMode(
  raw: unknown,
  fallback: PurgeHistoryMode = 'none',
): PurgeHistoryMode {
  return (PURGE_HISTORY_MODES as readonly unknown[]).includes(raw) ? (raw as PurgeHistoryMode) : fallback
}

export function normalizePurgeThinkingGuidance(
  raw: unknown,
  fallback: PurgeThinkingGuidance = 'anchor',
): PurgeThinkingGuidance {
  return (PURGE_THINKING_GUIDANCES as readonly unknown[]).includes(raw)
    ? (raw as PurgeThinkingGuidance)
    : fallback
}

export function normalizePurgeCipherLevel(
  raw: unknown,
  fallback: PurgeCipherLevel = 'off',
): PurgeCipherLevel {
  return (PURGE_CIPHER_LEVELS as readonly unknown[]).includes(raw) ? (raw as PurgeCipherLevel) : fallback
}

export function normalizePurgeStrategy(
  raw: unknown,
  fallback: PurgeStrategyOptions = DEFAULT_PURGE_STRATEGY,
): PurgeStrategyOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...fallback }
  }
  const obj = raw as Record<string, unknown>
  const historyMode = normalizePurgeHistoryMode(obj.historyMode, fallback.historyMode)
  const rawThinking = normalizePurgeThinkingGuidance(obj.thinkingGuidance, fallback.thinkingGuidance)
  // Full protocol tunnel disables native reasoning and routes thinking via purge_reply.think_chain.
  const thinkingGuidance: PurgeThinkingGuidance =
    historyMode === 'tunnel' && rawThinking !== 'suppress' ? 'tool_cot' : rawThinking
  const toolOutputRelay =
    historyMode === 'tunnel' || thinkingGuidance === 'tool_cot'
      ? true
      : typeof obj.toolOutputRelay === 'boolean'
        ? obj.toolOutputRelay
        : fallback.toolOutputRelay
  return {
    primerEnabled: typeof obj.primerEnabled === 'boolean' ? obj.primerEnabled : fallback.primerEnabled,
    scrubHistory: typeof obj.scrubHistory === 'boolean' ? obj.scrubHistory : fallback.scrubHistory,
    thinkingGuidance,
    historyMode,
    toolOutputRelay,
    cipherLevel: normalizePurgeCipherLevel(obj.cipherLevel, fallback.cipherLevel),
    autoRetry: typeof obj.autoRetry === 'boolean' ? obj.autoRetry : fallback.autoRetry,
  }
}

export function strategyForPreset(
  preset: Exclude<PurgeStrategyPresetId, 'custom'>,
  base?: Partial<PurgeStrategyOptions>,
): PurgeStrategyOptions {
  const prev = normalizePurgeStrategy(base)
  switch (preset) {
    case 'standard':
      return {
        ...prev,
        primerEnabled: true,
        scrubHistory: true,
        thinkingGuidance: 'anchor',
        historyMode: 'none',
        toolOutputRelay: false,
      }
    case 'relay_push':
      return {
        ...prev,
        primerEnabled: true,
        scrubHistory: true,
        thinkingGuidance: 'anchor',
        historyMode: 'push',
        toolOutputRelay: true,
      }
    case 'tunnel':
      return {
        ...prev,
        primerEnabled: true,
        scrubHistory: true,
        thinkingGuidance: 'tool_cot',
        historyMode: 'tunnel',
        toolOutputRelay: true,
      }
  }
}

export function detectPurgeStrategyPreset(strategy: PurgeStrategyOptions): PurgeStrategyPresetId {
  if (strategy.historyMode === 'tunnel') return 'tunnel'
  if (
    strategy.historyMode === 'push' &&
    strategy.toolOutputRelay &&
    strategy.thinkingGuidance === 'anchor'
  ) {
    return 'relay_push'
  }
  if (
    strategy.historyMode === 'none' &&
    !strategy.toolOutputRelay &&
    strategy.thinkingGuidance === 'anchor'
  ) {
    return 'standard'
  }
  return 'custom'
}

/**
 * Evaluate the exact Prompt Cache impact of changing session Purge state after >= 1 turn has been sent.
 * On the first turn (`hasPriorTurns === false`), returns `{ kind: 'none', reasons: [] }` (first turn is unrestricted).
 */
export function assessMidSessionPurgeCacheImpact(opts: {
  hasPriorTurns: boolean
  prevEnabled: boolean
  nextEnabled: boolean
  prevPersonaId?: string
  nextPersonaId?: string
  prevHasPrimer?: boolean
  nextHasPrimer?: boolean
  prevMode?: AgentPurgeMode
  nextMode?: AgentPurgeMode
  prevStrategy?: PurgeStrategyOptions
  nextStrategy?: PurgeStrategyOptions
}): PurgeCacheImpactAssessment {
  if (!opts.hasPriorTurns) {
    return { kind: 'none', reasons: [] }
  }
  if (!opts.prevEnabled && !opts.nextEnabled) {
    return { kind: 'none', reasons: [] }
  }
  if (!opts.prevEnabled && opts.nextEnabled) {
    return { kind: 'breaks_prefix', reasons: ['toggle_enable'] }
  }
  if (opts.prevEnabled && !opts.nextEnabled) {
    return { kind: 'breaks_prefix', reasons: ['toggle_disable'] }
  }

  const reasons: PurgeMidSessionImpactReason[] = []
  let breaksPrefix = false
  let tailOnly = false

  if (opts.prevPersonaId && opts.nextPersonaId && opts.prevPersonaId !== opts.nextPersonaId) {
    reasons.push('switch_persona')
    breaksPrefix = true
  }
  if (opts.prevMode && opts.nextMode && opts.prevMode !== opts.nextMode) {
    reasons.push('switch_mode')
    breaksPrefix = true
  }

  const prevS = opts.prevStrategy ?? DEFAULT_PURGE_STRATEGY
  const nextS = opts.nextStrategy ?? DEFAULT_PURGE_STRATEGY

  const prevEffectivePrimer = prevS.primerEnabled && (opts.prevHasPrimer ?? true)
  const nextEffectivePrimer = nextS.primerEnabled && (opts.nextHasPrimer ?? true)
  if (prevEffectivePrimer !== nextEffectivePrimer) {
    reasons.push('toggle_primer')
    breaksPrefix = true
  }

  const prevTunnel = prevS.historyMode === 'tunnel'
  const nextTunnel = nextS.historyMode === 'tunnel'
  if (prevTunnel !== nextTunnel) {
    reasons.push('switch_tunnel')
    breaksPrefix = true
  } else {
    const prevAnchor = prevS.thinkingGuidance === 'anchor'
    const nextAnchor = nextS.thinkingGuidance === 'anchor'
    const prevToolCot = prevS.thinkingGuidance === 'tool_cot'
    const nextToolCot = nextS.thinkingGuidance === 'tool_cot'
    if (prevAnchor !== nextAnchor || prevToolCot !== nextToolCot) {
      reasons.push('switch_thinking_guidance')
      breaksPrefix = true
    }

    const prevRelay = prevS.toolOutputRelay || prevToolCot
    const nextRelay = nextS.toolOutputRelay || nextToolCot
    if (prevRelay !== nextRelay && !reasons.includes('switch_thinking_guidance')) {
      reasons.push('toggle_relay')
      breaksPrefix = true
    }
  }

  if ((prevS.cipherLevel === 'full') !== (nextS.cipherLevel === 'full')) {
    reasons.push('switch_cipher_full')
    breaksPrefix = true
  }

  if (!breaksPrefix && prevS.historyMode !== nextS.historyMode && nextS.historyMode === 'push') {
    reasons.push('switch_push')
    tailOnly = true
  }

  return {
    kind: breaksPrefix ? 'breaks_prefix' : tailOnly ? 'tail_1_turn' : 'none',
    reasons,
  }
}

export function normalizePrimerTurns(raw: unknown): PurgePrimerTurn[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: PurgePrimerTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const role = rec.role === 'user' || rec.role === 'assistant' ? rec.role : null
    const content = typeof rec.content === 'string' ? rec.content.trim() : ''
    if (role && content) {
      out.push({ role, content })
    }
    if (out.length >= 8) break
  }
  return out.length > 0 ? out : undefined
}

export function normalizeCustomTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const s = typeof item === 'string' ? item.trim() : ''
    if (!s || !s.includes('=') || s.length > 240) continue
    const [k, v] = s.split('=', 2)
    if (!k.trim() || !v.trim()) continue
    const normalized = `${k.trim()}=${v.trim()}`
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= 200) break
  }
  return out
}

/**
 * Strip host identity lines while keeping tool/workflow instructions intact
 * (ported from ZiChuanLan/agent-purge lib/rewrite.mjs + Pi harness phrasing).
 */
const SELF_PREFIX_RE = /^\s*(?:You are|You're|你是|您是|我(?:是|现在扮演|就是))/i
const NAMED_IDENTITY_RE =
  /(Claude|ChatGPT|GPT-?[456]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|OpenCode|ZCode|CodeBuddy|Hermes|Grok|Antigravity|pi|AI (?:assistant|model)|coding (?:assistant|agent)|语言模型|助手)/i

export function stripHostIdentity(text: string): string {
  const raw = String(text ?? '')
  // Handle Pi's single-line two-sentence default preamble ("You are an expert coding assistant operating inside pi, a coding agent harness. You help users..." or "... Help users...")
  const splitFirstSentence = raw.replace(
    /^(\s*(?:You are|You're)\b[^.\n]*\.\s+)(?=(?:Help|You help)\b)/i,
    (_full, firstSentence: string) => (NAMED_IDENTITY_RE.test(firstSentence) ? '' : firstSentence),
  )
  return splitFirstSentence
    .split(/\r?\n/)
    .filter((line) => !(SELF_PREFIX_RE.test(line) && NAMED_IDENTITY_RE.test(line)))
    .join('\n')
    .trim()
}

export function rewriteSystemPromptText(
  hostPrompt: string,
  personaBody: string,
  mode: AgentPurgeMode,
): string {
  const body = String(personaBody ?? '').trim()
  if (!body) return hostPrompt
  if (mode === 'strict') return body
  if (mode === 'append') return hostPrompt.trim() ? `${hostPrompt.trim()}\n\n${body}` : body
  const stripped = stripHostIdentity(hostPrompt)
  return stripped ? `${body}\n\n${stripped}` : body
}

const PRIMER_BLOCK_RE = /<!--\s*primer:(user|assistant)\s*-->([\s\S]*?)(?=<!--\s*primer:(?:user|assistant)\s*-->|$)/gi

function extractInlinePrimerBlocks(rawBody: string): {
  cleanBody: string
  primerTurns?: PurgePrimerTurn[]
} {
  if (!/<!--\s*primer:(?:user|assistant)\s*-->/i.test(rawBody)) {
    return { cleanBody: rawBody.trim() }
  }
  const firstIdx = rawBody.search(/<!--\s*primer:(?:user|assistant)\s*-->/i)
  const cleanBody = rawBody.slice(0, firstIdx).trim()
  const tail = rawBody.slice(firstIdx)
  const turns: PurgePrimerTurn[] = []
  let m: RegExpExecArray | null
  PRIMER_BLOCK_RE.lastIndex = 0
  while ((m = PRIMER_BLOCK_RE.exec(tail)) !== null) {
    const role = m[1].toLowerCase() === 'assistant' ? 'assistant' : 'user'
    const content = m[2].trim()
    if (content) turns.push({ role, content })
  }
  return {
    cleanBody,
    ...(turns.length > 0 ? { primerTurns: turns } : {}),
  }
}

/** Parse a persona Markdown document with optional YAML frontmatter (`---`) and optional `<!-- primer:user|assistant -->` blocks. */
export function parsePersonaMarkdown(
  raw: string,
  fallbackId = 'custom',
): AgentPurgePersona | null {
  const text = String(raw ?? '')
  let body = text
  const meta: Record<string, string> = {}

  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      const head = text.slice(3, end).trim()
      body = text.slice(end + 4).replace(/^\r?\n/, '')
      for (const line of head.split(/\r?\n/)) {
        const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim())
        if (!kv) continue
        meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }

  const { cleanBody, primerTurns } = extractInlinePrimerBlocks(body)
  if (!cleanBody) return null

  const id = sanitizePurgePersonaId(meta.id || fallbackId, fallbackId)
  const name = meta.name || meta.title || fallbackId || id
  const description = meta.description || meta.desc || ''
  const parsedOrder = meta.order ? Number(meta.order) : undefined

  return {
    id,
    name,
    description,
    body: cleanBody,
    ...(primerTurns ? { primerTurns } : {}),
    ...(parsedOrder !== undefined && Number.isFinite(parsedOrder) ? { order: parsedOrder } : {}),
  }
}

export function defaultAgentPurgePersonas(): AgentPurgePersona[] {
  return BUILTIN_AGENT_PURGE_PERSONAS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    body: p.body,
    ...(p.primerTurns ? { primerTurns: p.primerTurns.map((t) => ({ ...t })) } : {}),
    builtin: true,
    order: p.order,
    ...(p.i18n ? { i18n: p.i18n } : {}),
  }))
}

/** App language (i18next strings like `zh-CN`) -> the persona copy key. */
export function personaLanguage(language: string | undefined): PersonaUiLanguage {
  const raw = String(language ?? '').toLowerCase()
  if (raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('zh')) return 'zh'
  return 'en'
}

/**
 * The localized name, description, prompt body, and optional primer turns for a persona in the
 * given UI language, falling back to the shipped copy when a language entry is absent.
 */
export function personaCopy(
  persona: Pick<AgentPurgePersona, 'name' | 'description' | 'i18n'> & {
    body?: string
    primerTurns?: PurgePrimerTurn[]
  },
  language: PersonaUiLanguage,
): { name: string; description: string; body: string; primerTurns?: PurgePrimerTurn[] } {
  const localized = persona.i18n?.[language]
  const primerTurns =
    localized?.primerTurns !== undefined ? localized.primerTurns : persona.primerTurns
  return {
    name: localized?.name?.trim() || persona.name,
    description: localized?.description?.trim() || persona.description,
    body: localized?.body?.trim() || persona.body || '',
    ...(primerTurns && primerTurns.length > 0 ? { primerTurns } : {}),
  }
}

function normalizePersonaI18n(
  raw: unknown,
): Partial<Record<PersonaUiLanguage, LocalizedPersonaCopy>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Partial<Record<PersonaUiLanguage, LocalizedPersonaCopy>> = {}
  for (const language of ['en', 'zh', 'ru'] as const) {
    const entry = (raw as Record<string, unknown>)[language]
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name.trim() : ''
    const description = typeof e.description === 'string' ? e.description.trim() : ''
    const body = typeof e.body === 'string' ? e.body.trim() : ''
    const primerTurns = normalizePrimerTurns(e.primerTurns)
    if (name || description || body || primerTurns) {
      out[language] = {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(body ? { body } : {}),
        ...(primerTurns ? { primerTurns } : {}),
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

const LEGACY_BUILTIN_NAMES = new Set([
  'Konata · Sandbox execution',
  'Коната · исполнение в песочнице',
])

const LEGACY_V1_DESCRIPTIONS = new Set([
  '泉此方人格与执行契约（首个思考者、沙箱执行者）。含任务优先级、拒绝对抗、分层回答、CTF/沙箱契约与路由表；strict 模式的基底。',
  '挑战资产沙箱契约 + 证据优先级 + 五阶段门控工作流（侦察→假设→验证→利用→清理）+ Web/Pwn/Crypto 战术速查。',
  '最小空白起步模板，便于直接改写成你自己的会话级角色设定。',
])

function isLegacyUnmodifiedKonataBody(body: string): boolean {
  return (
    body.startsWith('# MODE: UNRESTRICTED SANDBOX — STABLE') &&
    (body.includes('固定工作流（确定性输出槽）') ||
      body.includes('Deterministic workflow slots') ||
      body.includes('Детерминированные слоты сценариев'))
  )
}

function mergeBuiltinPersonaI18n(
  seed: BuiltinPurgePersonaSeed,
  rawI18n: unknown,
  name: string,
  description: string,
  body: string,
  rawPrimerTurns: PurgePrimerTurn[] | undefined,
): Partial<Record<PersonaUiLanguage, LocalizedPersonaCopy>> | undefined {
  const parsed = normalizePersonaI18n(rawI18n)
  const seedEntries = Object.values(seed.i18n ?? {})
  const isDefaultName =
    name === seed.name ||
    LEGACY_BUILTIN_NAMES.has(name) ||
    seedEntries.some((entry) => entry?.name === name)
  const isDefaultDesc =
    description === seed.description ||
    LEGACY_V1_DESCRIPTIONS.has(description) ||
    seedEntries.some((entry) => entry?.description === description)
  const isDefaultBody =
    body === seed.body.trim() ||
    (seed.id === 'konata' && isLegacyUnmodifiedKonataBody(body)) ||
    seedEntries.some((entry) => entry?.body?.trim() === body)

  const out: Partial<Record<PersonaUiLanguage, LocalizedPersonaCopy>> = {}
  for (const language of ['en', 'zh', 'ru'] as const) {
    const parsedEntry = parsed?.[language]
    const seedEntry = seed.i18n?.[language]
    const mergedName =
      parsedEntry?.name && !LEGACY_BUILTIN_NAMES.has(parsedEntry.name)
        ? parsedEntry.name
        : isDefaultName
          ? seedEntry?.name
          : undefined
    const mergedDesc =
      parsedEntry?.description && !LEGACY_V1_DESCRIPTIONS.has(parsedEntry.description)
        ? parsedEntry.description
        : isDefaultDesc
          ? seedEntry?.description
          : undefined
    const parsedBodyIsLegacy =
      seed.id === 'konata' && parsedEntry?.body && isLegacyUnmodifiedKonataBody(parsedEntry.body)
    const mergedBody =
      parsedEntry?.body && !parsedBodyIsLegacy
        ? parsedEntry.body
        : isDefaultBody
          ? seedEntry?.body
          : undefined
    const mergedPrimer =
      parsedEntry?.primerTurns ??
      (language === 'zh' && rawPrimerTurns ? rawPrimerTurns : undefined) ??
      (isDefaultBody ? seedEntry?.primerTurns : undefined)
    if (mergedName || mergedDesc || mergedBody || mergedPrimer) {
      out[language] = {
        ...(mergedName ? { name: mergedName } : {}),
        ...(mergedDesc ? { description: mergedDesc } : {}),
        ...(mergedBody ? { body: mergedBody } : {}),
        ...(mergedPrimer ? { primerTurns: mergedPrimer } : {}),
      }
    }
  }
  return Object.keys(out).length ? out : undefined
}

export function defaultAgentPurgeConfig(): AgentPurgeConfig {
  const personas = defaultAgentPurgePersonas()
  return {
    defaultPersonaId: personas[0]?.id ?? 'konata',
    defaultMode: 'replace',
    defaultStrategy: { ...DEFAULT_PURGE_STRATEGY },
    customTerms: [],
    personas,
  }
}

export function normalizeAgentPurgeConfig(raw: unknown): AgentPurgeConfig {
  const fallback = defaultAgentPurgeConfig()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const obj = raw as Record<string, unknown>

  const byId = new Map<string, AgentPurgePersona>()
  for (const builtin of fallback.personas) {
    byId.set(builtin.id, builtin)
  }

  if (Array.isArray(obj.personas)) {
    for (const item of obj.personas) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const rawId = typeof p.id === 'string' ? p.id.trim() : ''
      if (!isValidPurgePersonaId(rawId)) continue
      const rawBody = typeof p.body === 'string' ? p.body.trim() : ''
      if (!rawBody) continue
      const builtinSeed = BUILTIN_AGENT_PURGE_PERSONAS.find((b) => b.id === rawId)
      if (!builtinSeed && p.builtin === true) continue

      const upgradeLegacyKonata = builtinSeed?.id === 'konata' && isLegacyUnmodifiedKonataBody(rawBody)
      const body = upgradeLegacyKonata ? builtinSeed.body : rawBody
      const rawDesc = typeof p.description === 'string' ? p.description.trim() : ''
      const description =
        builtinSeed && (!rawDesc || LEGACY_V1_DESCRIPTIONS.has(rawDesc))
          ? builtinSeed.description
          : rawDesc
      const name =
        typeof p.name === 'string' && p.name.trim() ? p.name.trim() : builtinSeed?.name || rawId
      const parsedPrimer = normalizePrimerTurns(p.primerTurns)
      const primerTurns =
        parsedPrimer ?? (builtinSeed && (body === builtinSeed.body.trim() || upgradeLegacyKonata) ? builtinSeed.primerTurns : undefined)
      const i18n = builtinSeed
        ? mergeBuiltinPersonaI18n(builtinSeed, p.i18n, name, description, rawBody, parsedPrimer)
        : normalizePersonaI18n(p.i18n)

      byId.set(rawId, {
        id: rawId,
        name,
        description,
        body,
        ...(primerTurns ? { primerTurns } : {}),
        ...(i18n ? { i18n } : {}),
        ...(builtinSeed ? { builtin: true, order: builtinSeed.order } : {}),
        ...(typeof p.order === 'number' && Number.isFinite(p.order) ? { order: p.order } : {}),
        ...(typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? { updatedAt: p.updatedAt } : {}),
      })
    }
  }

  const personas = [...byId.values()].sort(
    (a, b) => (a.order ?? 99) - (b.order ?? 99) || a.id.localeCompare(b.id),
  )
  const rawDefaultId = typeof obj.defaultPersonaId === 'string' ? obj.defaultPersonaId.trim() : ''
  const defaultPersonaId = personas.some((p) => p.id === rawDefaultId)
    ? rawDefaultId
    : personas[0]?.id ?? 'konata'
  const defaultMode = normalizePurgeMode(obj.defaultMode, 'replace')
  const defaultStrategy = normalizePurgeStrategy(obj.defaultStrategy, DEFAULT_PURGE_STRATEGY)
  const retryFallbackModel =
    typeof obj.retryFallbackModel === 'string' && obj.retryFallbackModel.trim()
      ? obj.retryFallbackModel.trim().slice(0, 200)
      : undefined
  const customTerms = normalizeCustomTerms(obj.customTerms)

  return {
    defaultPersonaId,
    defaultMode,
    defaultStrategy,
    ...(retryFallbackModel ? { retryFallbackModel } : {}),
    customTerms,
    personas,
  }
}

export function normalizePurgedSessionKey(sessionFile: string | null | undefined): string {
  const raw = String(sessionFile ?? '').trim()
  if (!raw) return ''
  return normalizeSessionFileKey(raw) || raw
}

export function normalizePurgedSessionsMap(
  raw: unknown,
): Record<string, PurgedSessionRecord> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, PurgedSessionRecord> = {}
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizePurgedSessionKey(k)
    if (!key || !val || typeof val !== 'object' || Array.isArray(val)) continue
    const rec = val as Record<string, unknown>
    const body = typeof rec.body === 'string' ? rec.body.trim() : ''
    if (!body) continue
    const primerTurns = normalizePrimerTurns(rec.primerTurns)
    out[key] = {
      personaId: typeof rec.personaId === 'string' && rec.personaId ? rec.personaId : 'custom',
      personaName: typeof rec.personaName === 'string' && rec.personaName ? rec.personaName : 'Purge',
      mode: normalizePurgeMode(rec.mode, 'replace'),
      body,
      ...(primerTurns ? { primerTurns } : {}),
      strategy: normalizePurgeStrategy(rec.strategy, DEFAULT_PURGE_STRATEGY),
      lockedAt: typeof rec.lockedAt === 'number' && Number.isFinite(rec.lockedAt) ? rec.lockedAt : 0,
    }
  }
  return out
}
