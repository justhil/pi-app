/** 输入框 / 状态条用的模型、thinking 展示（禁止出现 undefined 字面量） */

const INVALID = new Set(['', 'undefined', 'null', 'none'])

export function normalizeModelKey(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim()
  if (!s || INVALID.has(s.toLowerCase())) return undefined
  return s
}

export function formatModelChip(model: unknown): string {
  const key = normalizeModelKey(model)
  if (!key) return '选择模型'
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
  return key ?? '未选择'
}

const THINKING_LABEL: Record<string, string> = {
  off: '关',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

export function normalizeThinkingLevel(raw: unknown): string | undefined {
  if (raw == null) return undefined
  const s = String(raw).trim().toLowerCase()
  if (!s || INVALID.has(s)) return undefined
  return s
}

export function formatThinkingChip(level: unknown): string {
  const key = normalizeThinkingLevel(level) ?? 'off'
  return THINKING_LABEL[key] ?? key
}

export function sanitizeRunStatePatch(patch: {
  model?: unknown
  thinkingLevel?: unknown
  [k: string]: unknown
}): { model?: string; thinkingLevel?: string; [k: string]: unknown } {
  const out = { ...patch }
  if ('model' in patch) {
    const m = normalizeModelKey(patch.model)
    if (m) out.model = m
    else delete out.model
  }
  if ('thinkingLevel' in patch) {
    const t = normalizeThinkingLevel(patch.thinkingLevel)
    if (t) out.thinkingLevel = t
    else delete out.thinkingLevel
  }
  return out
}