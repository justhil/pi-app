// pi's `defaultTools` setting: plain names replace the defaults, `+name` / `-name` adjust them.
// The settings page edits the effective set and saves it back as +/- changes against the defaults,
// so a project-level list of +/- entries keeps working on top of it.

export const PI_DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'] as const
export const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
/** Built-in extension tools pi registers inactive until named in defaultTools. */
export const PI_OPTIONAL_TOOLS = ['codemode', 'tool_search'] as const

export const TOOL_ENTRY = /^[+-]?[A-Za-z_][A-Za-z0-9_]*$/

/** The tools pi enables at startup for a raw `defaultTools` value. */
export function resolveDefaultTools(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set(PI_DEFAULT_TOOLS)
  const entries = raw.filter((e): e is string => typeof e === 'string' && TOOL_ENTRY.test(e))
  const plain = entries.filter((e) => !/^[+-]/.test(e))
  const onlyDeltas = plain.length === 0 && entries.length > 0
  const out = new Set<string>(onlyDeltas ? PI_DEFAULT_TOOLS : plain)
  for (const e of entries) {
    if (e.startsWith('+')) out.add(e.slice(1))
    else if (e.startsWith('-')) out.delete(e.slice(1))
  }
  return out
}

/** `selected` as +/- changes against pi's defaults; undefined when it equals them. */
export function encodeDefaultTools(selected: Iterable<string>): string[] | undefined {
  const set = new Set(selected)
  const out: string[] = []
  for (const name of PI_DEFAULT_TOOLS) if (!set.has(name)) out.push(`-${name}`)
  for (const name of set) if (!(PI_DEFAULT_TOOLS as readonly string[]).includes(name)) out.push(`+${name}`)
  return out.length ? out : undefined
}

/** Toggle one tool in a raw `defaultTools` value, keeping tools the page does not show. */
export function withTool(raw: unknown, name: string, on: boolean): string[] | undefined {
  const set = resolveDefaultTools(raw)
  if (on) set.add(name)
  else set.delete(name)
  return encodeDefaultTools(set)
}
