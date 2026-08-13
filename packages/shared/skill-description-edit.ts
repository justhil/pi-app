const SIMPLE_DESC = /^description:\s*(?:"([^"]*)"|'([^']*)'|([^\n\r]*))\s*$/m

export function replaceSkillDescription(
  raw: string,
  description: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  if (/[\u0000-\u0008]/.test(raw)) return { ok: false, reason: 'unsupported-encoding' }
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = bom ? raw.slice(1) : raw
  if (!body.startsWith('---')) return { ok: false, reason: 'no-frontmatter' }
  const match = body.match(SIMPLE_DESC)
  if (!match) return { ok: false, reason: 'complex-yaml' }
  const current = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  if (current === '|' || current === '>' || current.endsWith('|') || current.endsWith('>')) {
    return { ok: false, reason: 'complex-yaml' }
  }
  const safe = description.replace(/\r?\n/g, ' ').trim()
  const quoted = `"${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return { ok: true, content: bom + body.replace(SIMPLE_DESC, `description: ${quoted}`) }
}
