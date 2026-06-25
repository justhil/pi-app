/** API model id: allows alphanumeric and common separators, no control chars */
const MODEL_ID_RE = /^[\w][\w.\-:+/%@]*$/

import i18n from '@renderer/lib/i18n'

export function sanitizeModelId(raw: string): string {
  return raw.trim().replace(/\s+/g, '')
}

export function validateModelId(id: string): { ok: true } | { ok: false; reason: string } {
  if (!id) return { ok: false, reason: i18n.t('models:errEmpty') }
  if (id.length > 256) return { ok: false, reason: i18n.t('models:errTooLong') }
  if (/[\x00-\x1f]/.test(id)) return { ok: false, reason: i18n.t('models:errControlChar') }
  if (!MODEL_ID_RE.test(id)) {
    return {
      ok: false,
      reason: i18n.t('models:errInvalidFormat'),
    }
  }
  return { ok: true }
}

/** Parse multiple model ids from pasted text (newline, comma, semicolon) */
export function parseModelIdList(text: string): string[] {
  const parts = text.split(/[\n,;]+/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const id = sanitizeModelId(p)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}