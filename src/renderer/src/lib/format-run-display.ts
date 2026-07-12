/** Model / thinking display helpers for input strip / status bar (no raw undefined) */

import i18n from '@renderer/lib/i18n'

const INVALID = new Set(['', 'undefined', 'null', 'none'])

export function normalizeModelKey(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s || INVALID.has(s.toLowerCase())) return undefined
  return s
}

export function formatModelChip(model: unknown): string {
  const key = normalizeModelKey(model)
  if (!key) return i18n.t('composer:selectModel')
  const slash = key.indexOf('/')
  if (slash >= 0) {
    const provider = key.slice(0, slash)
    const id = key.slice(slash + 1)
    if (id && id !== 'undefined') return id
    if (provider && provider !== 'undefined') return provider
  }
  return key
}

export function formatModelFull(model: unknown): string {
  const key = normalizeModelKey(model)
  return key ?? i18n.t('composer:noModelSelected')
}

const THINKING_LABEL_KEYS: Record<string, string> = {
  off: 'composer:thinkingOff',
  minimal: 'composer:thinkingMinimal',
  low: 'composer:thinkingLow',
  medium: 'composer:thinkingMedium',
  high: 'composer:thinkingHigh',
  xhigh: 'composer:thinkingXhigh',
}

export function normalizeThinkingLevel(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim().toLowerCase()
  if (!s || INVALID.has(s)) return undefined
  return s
}

export function formatThinkingChip(level: unknown): string {
  const key = normalizeThinkingLevel(level) ?? 'off'
  return THINKING_LABEL_KEYS[key] ? i18n.t(THINKING_LABEL_KEYS[key]) : key
}

export function sanitizeRunStatePatch(patch: {
  model?: unknown
  thinkingLevel?: unknown
  [k: string]: unknown
}): { model?: string | null; thinkingLevel?: string | null; [k: string]: unknown } {
  const out: { model?: string | null; thinkingLevel?: string | null; [k: string]: unknown } = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k !== 'model' && k !== 'thinkingLevel') out[k] = v
  }
  // Explicit model/thinking keys may clear (null) so bound runtime can wipe stale JSONL display.
  if ('model' in patch) {
    const m = normalizeModelKey(patch.model)
    out.model = m ?? null
  }
  if ('thinkingLevel' in patch) {
    const t = normalizeThinkingLevel(patch.thinkingLevel)
    out.thinkingLevel = t ?? null
  }
  return out
}