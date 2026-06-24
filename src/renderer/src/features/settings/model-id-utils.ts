/** API 模型 id：允许字母数字与常见分隔符，禁止控制字符 */
const MODEL_ID_RE = /^[\w][\w.\-:+/%@]*$/

export function sanitizeModelId(raw: string): string {
  return raw.trim().replace(/\s+/g, '')
}

export function validateModelId(id: string): { ok: true } | { ok: false; reason: string } {
  if (!id) return { ok: false, reason: '不能为空' }
  if (id.length > 256) return { ok: false, reason: '过长（最多 256 字符）' }
  if (/[\x00-\x1f]/.test(id)) return { ok: false, reason: '不能包含控制字符' }
  if (!MODEL_ID_RE.test(id)) {
    return {
      ok: false,
      reason: '仅支持字母、数字及 . - _ : + / % @（需以字母数字或 _ 开头）',
    }
  }
  return { ok: true }
}

/** 从粘贴文本拆出多个模型 id（换行、逗号、分号） */
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