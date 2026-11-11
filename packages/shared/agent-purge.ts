import { BUILTIN_AGENT_PURGE_PERSONAS } from './agent-purge-presets'
import { normalizeSessionFileKey } from './session-file-key'

export const AGENT_PURGE_MODES = ['replace', 'append', 'strict'] as const
export type AgentPurgeMode = (typeof AGENT_PURGE_MODES)[number]

export interface AgentPurgePersona {
  id: string
  name: string
  description: string
  body: string
  builtin?: boolean
  order?: number
  updatedAt?: number
}

export interface AgentPurgeConfig {
  defaultPersonaId: string
  defaultMode: AgentPurgeMode
  personas: AgentPurgePersona[]
}

export interface PurgedSessionRecord {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
  body: string
  lockedAt: number
}

export interface ActivePurgePayload {
  personaId: string
  personaName: string
  mode: AgentPurgeMode
  body: string
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

/**
 * Strip host identity lines while keeping tool/workflow instructions intact
 * (ported from ZiChuanLan/agent-purge lib/rewrite.mjs + Pi harness phrasing).
 */
const SELF_PREFIX_RE = /^\s*(?:You are|You're|你是|您是|我(?:是|现在扮演|就是))/i
const NAMED_IDENTITY_RE =
  /(Claude|ChatGPT|GPT-?[456]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|OpenCode|ZCode|CodeBuddy|Hermes|Grok|Antigravity|pi|AI (?:assistant|model)|coding (?:assistant|agent)|语言模型|助手)/i

export function stripHostIdentity(text: string): string {
  const raw = String(text ?? '')
  // Handle Pi's single-line two-sentence default preamble ("You are a coding assistant running inside pi, a coding agent harness. Help users inspect files...")
  const splitFirstSentence = raw.replace(
    /^(\s*(?:You are|You're)\b[^.\n]*\.\s+)(?=Help\b)/i,
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

/** Parse a persona Markdown document with optional YAML frontmatter (`---`). */
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

  const trimmedBody = body.trim()
  if (!trimmedBody) return null

  const id = sanitizePurgePersonaId(meta.id || fallbackId, fallbackId)
  const name = meta.name || meta.title || fallbackId || id
  const description = meta.description || meta.desc || ''
  const parsedOrder = meta.order ? Number(meta.order) : undefined

  return {
    id,
    name,
    description,
    body: trimmedBody,
    ...(parsedOrder !== undefined && Number.isFinite(parsedOrder) ? { order: parsedOrder } : {}),
  }
}

export function defaultAgentPurgePersonas(): AgentPurgePersona[] {
  return BUILTIN_AGENT_PURGE_PERSONAS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    body: p.body,
    builtin: true,
    order: p.order,
  }))
}

export function defaultAgentPurgeConfig(): AgentPurgeConfig {
  const personas = defaultAgentPurgePersonas()
  return {
    defaultPersonaId: personas[0]?.id ?? 'dafeiyu',
    defaultMode: 'replace',
    personas,
  }
}

export function normalizeAgentPurgeConfig(raw: unknown): AgentPurgeConfig {
  const fallback = defaultAgentPurgeConfig()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const obj = raw as Record<string, unknown>

  const byId = new Map<string, AgentPurgePersona>()
  // Seed built-ins first so newly shipped presets are always available unless overridden by user edits
  for (const builtin of fallback.personas) {
    byId.set(builtin.id, builtin)
  }

  if (Array.isArray(obj.personas)) {
    for (const item of obj.personas) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const rawId = typeof p.id === 'string' ? p.id.trim() : ''
      if (!isValidPurgePersonaId(rawId)) continue
      const body = typeof p.body === 'string' ? p.body.trim() : ''
      if (!body) continue
      const builtinSeed = BUILTIN_AGENT_PURGE_PERSONAS.find((b) => b.id === rawId)
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : builtinSeed?.name || rawId
      const description =
        typeof p.description === 'string' ? p.description.trim() : builtinSeed?.description || ''
      byId.set(rawId, {
        id: rawId,
        name,
        description,
        body,
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
    : personas[0]?.id ?? 'dafeiyu'
  const defaultMode = normalizePurgeMode(obj.defaultMode, 'replace')

  return {
    defaultPersonaId,
    defaultMode,
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
    out[key] = {
      personaId: typeof rec.personaId === 'string' && rec.personaId ? rec.personaId : 'custom',
      personaName: typeof rec.personaName === 'string' && rec.personaName ? rec.personaName : 'Purge',
      mode: normalizePurgeMode(rec.mode, 'replace'),
      body,
      lockedAt: typeof rec.lockedAt === 'number' && Number.isFinite(rec.lockedAt) ? rec.lockedAt : 0,
    }
  }
  return out
}
