/** Shared JSONPath-lite + tool-card status extraction (Worker + Renderer). */

export function extractJsonPath(obj: unknown, path: string): unknown {
  if (!obj || typeof path !== 'string') return undefined
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function textFromOutput(output: unknown): string {
  if (!output) return ''
  if (typeof output === 'string') return output
  if (Array.isArray((output as { content?: unknown }).content)) {
    return (output as { content: { text?: string }[] }).content.map((c) => c?.text || '').join('')
  }
  if (typeof (output as { text?: string }).text === 'string') return (output as { text: string }).text
  return ''
}

/** Resolve status line for tool updates using adapter.toolCard.statusField when set. */
export function extractStatusFromOutput(output: unknown, statusField?: string): string | null {
  let text = ''
  if (statusField) {
    let root: unknown = output
    if (typeof output === 'string' && statusField.startsWith('$.')) {
      try {
        root = JSON.parse(output)
      } catch (e) {
        root = { text: output }
      }
    }
    const v = extractJsonPath(root, statusField)
    if (v != null && String(v).trim()) text = String(v).trim()
  }
  if (!text) text = textFromOutput(output).trim()
  if (!text) return null
  if (text.length > 120) return `${text.slice(0, 120)}…`
  return text
}

/** Apply toolCard.fields mappings from tool args / details / output. */
export function applyToolCardFields(
  sources: { args?: unknown; details?: unknown; output?: unknown },
  fields?: Record<string, string>,
): Record<string, unknown> {
  if (!fields) return {}
  const out: Record<string, unknown> = {}
  for (const [key, path] of Object.entries(fields)) {
    if (path.startsWith('$.args.')) {
      out[key] = extractJsonPath(sources.args, `$.${path.slice('$.args.'.length)}`)
    } else if (path.startsWith('$.details.')) {
      out[key] = extractJsonPath(sources.details, `$.${path.slice('$.details.'.length)}`)
    } else if (path.startsWith('$.output.')) {
      let o = sources.output
      if (typeof o === 'string') {
        try {
          o = JSON.parse(o)
        } catch (e) {
          o = { text: o }
        }
      }
      out[key] = extractJsonPath(o, `$.${path.slice('$.output.'.length)}`)
    } else {
      out[key] =
        extractJsonPath(sources.args, path)
        ?? extractJsonPath(sources.details, path)
        ?? extractJsonPath(sources.output, path)
    }
  }
  return out
}