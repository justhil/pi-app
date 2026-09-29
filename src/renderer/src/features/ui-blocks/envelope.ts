export type UIBlockEnvelope = {
  component: string
  id: string
  version: number
  props: Record<string, unknown>
}

export type ParsedUIBlock =
  | { status: 'incomplete' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; envelope: UIBlockEnvelope }

/**
 * Parse a pi-ui fence body. While streaming, a body whose brackets are still open is
 * "incomplete" (skeleton) — checked before JSON.parse so every streamed frame does not pay for a
 * thrown exception. Once balanced, a body that still fails is invalid even mid-stream.
 */
export function parseUIBlock(raw: string, streaming: boolean): ParsedUIBlock {
  const text = raw.trim()
  if (!text) return { status: 'incomplete' }
  if (streaming && !bracketsBalanced(text)) return { status: 'incomplete' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    try {
      json = JSON.parse(repairJSON(text))
    } catch (error) {
      if (streaming && !bracketsBalanced(text)) return { status: 'incomplete' }
      return { status: 'invalid', message: error instanceof Error ? error.message : 'invalid JSON' }
    }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { status: 'invalid', message: 'expected a JSON object' }
  }
  const source = json as Record<string, unknown>
  const component = typeof source.component === 'string' ? source.component.trim() : ''
  if (!component) return { status: 'invalid', message: 'missing "component"' }
  const props = source.props
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return { status: 'invalid', message: '"props" must be an object' }
  }
  const id =
    typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : typeof source.id === 'number'
        ? String(source.id)
        : component
  return {
    status: 'ok',
    envelope: { component, id, version: normalizeVersion(source.version), props: props as Record<string, unknown> },
  }
}

/** "1", "v1", 1.0 and a missing version all mean 1. */
function normalizeVersion(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.trunc(value))
  if (typeof value === 'string') {
    const match = /^v?(\d+)(?:\.\d+)?$/i.exec(value.trim())
    if (match) return Math.max(1, Number.parseInt(match[1], 10))
  }
  return 1
}

const STRUCTURAL_AFTER_STRING = new Set([',', '}', ']', ':'])

/**
 * Repair the JSON slips models make most: trailing commas, // and /* *\/ comments, and raw
 * double quotes inside strings (common when CJK prose quotes a term). A quote closes a string only
 * when the next significant character is structural.
 */
export function repairJSON(text: string): string {
  let out = ''
  let inString = false
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (inString) {
      if (char === '\\') {
        out += char + (text[index + 1] ?? '')
        index += 2
        continue
      }
      if (char === '"') {
        const next = text[nextSignificant(text, index + 1)]
        if (next === undefined || STRUCTURAL_AFTER_STRING.has(next)) {
          inString = false
          out += char
        } else {
          out += '\\"'
        }
        index += 1
        continue
      }
      // Raw control characters are illegal inside JSON strings; escape the common ones.
      if (char === '\n' || char === '\r' || char === '\t') {
        out += char === '\n' ? '\\n' : char === '\t' ? '\\t' : ''
        index += 1
        continue
      }
      out += char
      index += 1
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      index += 1
    } else if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else if (char === ',') {
      const next = text[nextSignificant(text, index + 1)]
      if (next !== '}' && next !== ']') out += char
      index += 1
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/** Index of the next character that is neither whitespace nor inside a // or /* *\/ comment. */
function nextSignificant(text: string, from: number): number {
  let index = from
  while (index < text.length) {
    const char = text[index]
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') index += 1
    else if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else break
  }
  return index
}

export function bracketsBalanced(text: string): boolean {
  let depth = 0
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return depth === 0 && !inString
}
