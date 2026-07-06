export type ToolCallDetail =
  | { type: 'bash'; command: string; exitCode?: number; output?: string }
  | { type: 'read'; path: string; offset?: number; limit?: number; snippet?: string }
  | { type: 'edit'; path: string; diff?: string; edits?: { oldText: string; newText: string }[] }
  | { type: 'write'; path: string; preview?: string }
  | { type: 'grep'; pattern: string; path?: string; matches?: string }
  | { type: 'find'; pattern: string; path?: string; matches?: string }
  | { type: 'unknown'; raw?: unknown }

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function toolCallDetailFromPi(
  toolName: string,
  toolArgs: unknown,
  toolOutput: unknown,
): ToolCallDetail {
  const name = toolName.toLowerCase()
  const args = asRecord(toolArgs)
  const out = typeof toolOutput === 'string' ? toolOutput : str(asRecord(toolOutput)?.output) ?? ''

  if (name === 'bash' || name === 'run_terminal_cmd') {
    return { type: 'bash', command: str(args?.command) ?? '', output: out.slice(0, 8000) }
  }
  if (name === 'read') {
    return {
      type: 'read',
      path: str(args?.path) ?? '',
      offset: num(args?.offset),
      limit: num(args?.limit),
      snippet: out.slice(0, 4000),
    }
  }
  if (name === 'edit' || name === 'write') {
    const path = str(args?.path) ?? ''
    if (name === 'write') {
      const content = str(args?.content) ?? out
      return { type: 'write', path, preview: content.slice(0, 2000) }
    }
    const editsRaw = args?.edits
    const edits = Array.isArray(editsRaw)
      ? editsRaw
          .map((e) => asRecord(e))
          .filter(Boolean)
          .map((e) => ({ oldText: str(e!.oldText) ?? '', newText: str(e!.newText) ?? '' }))
      : undefined
    const details = asRecord(toolOutput)
    const diff = str(details?.diff) ?? str(args?.diff)
    return { type: 'edit', path, diff, edits }
  }
  if (name === 'grep' || name === 'ffgrep') {
    return {
      type: 'grep',
      pattern: str(args?.pattern) ?? '',
      path: str(args?.path),
      matches: out.slice(0, 4000),
    }
  }
  if (name === 'find' || name === 'fffind') {
    return {
      type: 'find',
      pattern: str(args?.pattern) ?? '',
      path: str(args?.path),
      matches: out.slice(0, 4000),
    }
  }
  return { type: 'unknown', raw: { toolName, toolArgs, toolOutput } }
}