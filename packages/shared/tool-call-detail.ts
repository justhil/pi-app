export interface CodemodeNestedCall {
  id: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error' | 'cancelled'
  durationMs?: number
  error?: string
  cost?: number
}

export type ToolCallDetail =
  | { type: 'bash'; command: string; exitCode?: number; output?: string }
  | { type: 'read'; path: string; offset?: number; limit?: number; snippet?: string }
  | { type: 'edit'; path: string; diff?: string; edits?: { oldText: string; newText: string }[] }
  | { type: 'write'; path: string; preview?: string }
  | { type: 'grep'; pattern: string; path?: string; matches?: string }
  | { type: 'find'; pattern: string; path?: string; matches?: string }
  | { type: 'codemode'; code: string; summary: string; wallTimeSeconds?: number; output?: string }
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
  if (name === 'codemode') {
    const code = str(args?.code) ?? ''
    const stripped = stripCodemodeOutputHeader(out)
    return {
      type: 'codemode',
      code: code.slice(0, 8000),
      summary: firstMeaningfulCodeLine(code),
      ...(stripped.wallTimeSeconds !== undefined ? { wallTimeSeconds: stripped.wallTimeSeconds } : {}),
      output: stripped.body.slice(0, 8000),
    }
  }
  return { type: 'unknown', raw: { toolName, toolArgs, toolOutput } }
}

const CODEMODE_HEADER_RE = /^Script (completed|failed)\r?\nWall time ([\d.]+) seconds\r?\nOutput:\r?\n?/

export function stripCodemodeOutputHeader(rawText: string): {
  body: string
  wallTimeSeconds?: number
  status?: 'completed' | 'failed'
} {
  if (!rawText) return { body: '' }
  const match = CODEMODE_HEADER_RE.exec(rawText)
  if (!match) return { body: rawText.trim() }
  const wallTimeSeconds = Number(match[2])
  return {
    body: rawText.slice(match[0].length).trim(),
    ...(Number.isFinite(wallTimeSeconds) ? { wallTimeSeconds } : {}),
    status: match[1] as 'completed' | 'failed',
  }
}

export function parseCodemodeCalls(details: unknown): CodemodeNestedCall[] {
  const rec = asRecord(details)
  if (!rec || !Array.isArray(rec.calls)) return []
  const out: CodemodeNestedCall[] = []
  for (const raw of rec.calls) {
    const c = asRecord(raw)
    if (!c || typeof c.name !== 'string') continue
    const status = c.status
    const validStatus =
      status === 'running' || status === 'ok' || status === 'error' || status === 'cancelled'
        ? status
        : 'ok'
    out.push({
      id: typeof c.id === 'string' ? c.id : '',
      name: c.name,
      args: typeof c.args === 'string' ? c.args : '',
      status: validStatus,
      ...(typeof c.durationMs === 'number' && Number.isFinite(c.durationMs) ? { durationMs: c.durationMs } : {}),
      ...(typeof c.error === 'string' && c.error ? { error: c.error } : {}),
      ...(typeof c.cost === 'number' && Number.isFinite(c.cost) ? { cost: c.cost } : {}),
    })
  }
  return out
}

/** Extract a string field even when Pi truncated `call.args` JSON at 200 chars. */
export function extractCodemodeArgField(rawArgs: string, key: string): string | undefined {
  if (!rawArgs) return undefined
  try {
    const parsed = asRecord(JSON.parse(rawArgs))
    if (parsed && typeof parsed[key] === 'string') return parsed[key] as string
  } catch {
    /* truncated JSON fallback */
  }
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`)
  const m = re.exec(rawArgs)
  if (!m) return undefined
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

function shortFileName(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

export function summarizeCodemodeCallArg(toolName: string, rawArgs: string, maxChars = 72): string {
  const trimmed = rawArgs.trim()
  if (!trimmed) return ''
  const name = toolName.toLowerCase()
  const clip = (s: string) => {
    const oneLine = s.replace(/\s+/g, ' ').trim()
    return oneLine.length > maxChars ? oneLine.slice(0, maxChars - 1) + '…' : oneLine
  }
  if (name === 'read' || name === 'edit' || name === 'write' || name === 'ls') {
    const p = extractCodemodeArgField(trimmed, 'path') ?? extractCodemodeArgField(trimmed, 'file_path')
    if (p) return clip(p)
  }
  if (name === 'bash') {
    const cmd = extractCodemodeArgField(trimmed, 'command') ?? extractCodemodeArgField(trimmed, 'cmd')
    if (cmd) return clip(cmd)
  }
  if (name === 'grep' || name === 'ffgrep' || name === 'find' || name === 'fffind') {
    const pattern = extractCodemodeArgField(trimmed, 'pattern') ?? extractCodemodeArgField(trimmed, 'glob')
    const p = extractCodemodeArgField(trimmed, 'path')
    if (pattern) return clip(p ? `"${pattern}" in ${p}` : `"${pattern}"`)
  }
  if (name === 'ctx_reduce') {
    const drop = extractCodemodeArgField(trimmed, 'drop')
    if (drop) return clip(`drop ${drop}`)
  }
  for (const k of ['query', 'url', 'path', 'file_path', 'command', 'pattern', 'action']) {
    const v = extractCodemodeArgField(trimmed, k)
    if (v) return clip(v)
  }
  const stripped = trimmed.replace(/^\{|\}$/g, '').trim()
  return clip(stripped)
}

export function firstMeaningfulCodeLine(code: string, maxChars = 64): string {
  if (!code) return ''
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue
    return line.length > maxChars ? line.slice(0, maxChars - 1) + '…' : line
  }
  return ''
}

export function summarizeCodemodeCalls(
  calls: readonly CodemodeNestedCall[],
  opts?: { isRunning?: boolean; wallTimeSeconds?: number },
): string {
  if (calls.length === 0) return ''
  if (opts?.isRunning) {
    const running = calls.find((c) => c.status === 'running') ?? calls[calls.length - 1]
    const done = calls.filter((c) => c.status !== 'running').length
    const arg = summarizeCodemodeCallArg(running.name, running.args, 42)
    return `${done}/${calls.length} · ${running.name}${arg ? ` ${arg}` : ''}`
  }
  const groups = new Map<string, { count: number; target?: string }>()
  for (const call of calls) {
    const prev = groups.get(call.name) ?? { count: 0 }
    prev.count++
    if (!prev.target) {
      if (call.name === 'edit' || call.name === 'write' || call.name === 'read') {
        const p = extractCodemodeArgField(call.args, 'path') ?? extractCodemodeArgField(call.args, 'file_path')
        if (p) prev.target = shortFileName(p)
      } else if (call.name === 'bash') {
        const cmd = extractCodemodeArgField(call.args, 'command')
        if (cmd) prev.target = cmd.split(/\s+/)[0]
      }
    }
    groups.set(call.name, prev)
  }
  const parts: string[] = []
  for (const [name, info] of groups) {
    if (info.count === 1 && info.target) {
      parts.push(`${name} ${info.target}`)
    } else if (info.count > 1) {
      parts.push(`${name} ×${info.count}`)
    } else {
      parts.push(name)
    }
  }
  const head = parts.slice(0, 4).join(', ') + (parts.length > 4 ? ` +${parts.length - 4}` : '')
  const failed = calls.filter((c) => c.status === 'error').length
  const time =
    opts?.wallTimeSeconds !== undefined && opts.wallTimeSeconds > 0
      ? ` · ${opts.wallTimeSeconds.toFixed(1)}s`
      : ''
  return `${head}${failed > 0 ? ` · ${failed} failed` : ''}${time}`
}