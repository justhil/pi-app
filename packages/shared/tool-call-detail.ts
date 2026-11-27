export interface CodemodeNestedCall {
  id: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error' | 'cancelled'
  durationMs?: number
  error?: string
  cost?: number
  path?: string
  additions?: number
  deletions?: number
  arguments?: Record<string, unknown>
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

const MUTATE_TOOL_NAMES = new Set(['edit', 'write', 'insert'])

export function countTextLines(text: string): number {
  if (!text) return 0
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length
}

export function diffLineStatsFromStrings(
  oldStr: string,
  newStr: string,
): { additions: number; deletions: number } {
  if (oldStr === newStr) return { additions: 0, deletions: 0 }
  const oldLines = oldStr ? oldStr.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []
  const newLines = newStr ? newStr.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []
  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++
  }
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--
    newEnd--
  }
  const m = oldEnd - start
  const n = newEnd - start
  if (m === 0 || n === 0) return { additions: n, deletions: m }
  if (m * n > 40_000) return { additions: n, deletions: m }

  let prev = new Uint16Array(n + 1)
  let curr = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    const oLine = oldLines[start + i - 1]
    for (let j = 1; j <= n; j++) {
      if (oLine === newLines[start + j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = prev[j] >= curr[j - 1] ? prev[j] : curr[j - 1]
      }
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  const lcs = prev[n]
  return { additions: n - lcs, deletions: m - lcs }
}

function countPatchLines(patchText: string): { additions: number; deletions: number } | null {
  if (!patchText) return null
  let additions = 0
  let deletions = 0
  let sawMarker = false
  for (const raw of patchText.split(/\r?\n/)) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@') || raw.startsWith('\\ ')) {
      continue
    }
    if (raw.startsWith('+')) {
      sawMarker = true
      additions++
    } else if (raw.startsWith('-')) {
      sawMarker = true
      deletions++
    }
  }
  return sawMarker ? { additions, deletions } : null
}

function parseJsonObjectLoose(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return null
}

export function computeMutateCallDiffStats(
  toolName: string,
  inputArgs: unknown,
  details?: unknown,
): { path?: string; additions: number; deletions: number } {
  const name = toolName.toLowerCase()
  if (!MUTATE_TOOL_NAMES.has(name)) return { additions: 0, deletions: 0 }

  const argsObj = parseJsonObjectLoose(inputArgs)
  const rawArgsStr = typeof inputArgs === 'string' ? inputArgs : ''
  const path =
    str(argsObj?.path) ??
    str(argsObj?.file_path) ??
    str(argsObj?.filePath) ??
    (rawArgsStr
      ? extractCodemodeArgField(rawArgsStr, 'path') ?? extractCodemodeArgField(rawArgsStr, 'file_path')
      : undefined)

  const detObj = asRecord(details)
  const patchStats = countPatchLines(str(detObj?.patch) ?? str(argsObj?.patch) ?? str(detObj?.diff) ?? '')
  if (patchStats) {
    return { ...(path ? { path } : {}), ...patchStats }
  }

  if (name === 'write' || name === 'insert') {
    const content =
      str(argsObj?.content) ??
      str(argsObj?.new_string) ??
      str(argsObj?.newString) ??
      str(argsObj?.newText)
    if (content !== undefined) {
      return { ...(path ? { path } : {}), additions: countTextLines(content), deletions: 0 }
    }
    return { ...(path ? { path } : {}), additions: 0, deletions: 0 }
  }

  // edit
  if (argsObj) {
    const editsRaw = argsObj.edits
    if (Array.isArray(editsRaw) && editsRaw.length > 0) {
      let additions = 0
      let deletions = 0
      for (const entry of editsRaw) {
        const rec = asRecord(entry)
        if (!rec) continue
        const oldText = str(rec.oldText ?? rec.old_text ?? rec.oldString ?? rec.old_string) ?? ''
        const newText = str(rec.newText ?? rec.new_text ?? rec.newString ?? rec.new_string) ?? ''
        const s = diffLineStatsFromStrings(oldText, newText)
        additions += s.additions
        deletions += s.deletions
      }
      return { ...(path ? { path } : {}), additions, deletions }
    }
    const singleOld = str(argsObj.oldText ?? argsObj.old_text ?? argsObj.oldString ?? argsObj.old_string)
    const singleNew = str(argsObj.newText ?? argsObj.new_text ?? argsObj.newString ?? argsObj.new_string)
    if (singleOld !== undefined || singleNew !== undefined) {
      const s = diffLineStatsFromStrings(singleOld ?? '', singleNew ?? '')
      return { ...(path ? { path } : {}), ...s }
    }
  }

  return { ...(path ? { path } : {}), additions: 0, deletions: 0 }
}

/** Combine Pi toolResult `details` with Pi 1.5+ `nestedCalls` so untruncated arguments survive JSONL hydration. */
export function mergeCodemodeNestedCalls(details: unknown, nestedCalls: unknown): unknown {
  const nestedRec = asRecord(nestedCalls)
  if (!nestedRec || !Array.isArray(nestedRec.calls) || nestedRec.calls.length === 0) {
    return details
  }
  const detRec = asRecord(details)
  if (!detRec) return { nestedCalls: nestedRec }
  if (detRec.nestedCalls !== undefined) return details
  return { ...detRec, nestedCalls: nestedRec }
}

function unescapeJsStringLiteral(quote: string, raw: string): string {
  if (quote === '"') {
    try {
      return JSON.parse(`"${raw}"`)
    } catch {
      /* fallback */
    }
  }
  return raw.replace(/\\(r\n|\n|\r|n|r|t|\\|'|"`|`|\$)/g, (_m, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 'r') return '\r'
    if (ch === 't') return '\t'
    if (ch === '\n' || ch === '\r\n' || ch === '\r') return ''
    return ch
  })
}

function readJsStringAfterColon(src: string, startAt: number): { value: string; end: number } | null {
  let i = startAt
  while (i < src.length && /\s/.test(src[i])) i++
  const quote = src[i]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  i++
  let body = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      if (i + 1 < src.length) {
        body += ch + src[i + 1]
        i += 2
        continue
      }
      break
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      // Template interpolation cannot be statically evaluated accurately
      return null
    }
    if (ch === quote) {
      return { value: unescapeJsStringLiteral(quote, body), end: i + 1 }
    }
    body += ch
    i++
  }
  return null
}

function extractJsFieldString(slice: string, fieldName: string): string | undefined {
  const re = new RegExp(`(?:^|[,{\\s])(?:${fieldName}|"${fieldName}"|'${fieldName}')\\s*:`, 'g')
  const m = re.exec(slice)
  if (!m) return undefined
  const parsed = readJsStringAfterColon(slice, m.index + m[0].length)
  return parsed?.value
}

function extractLiteralCallSlicesFromCode(
  code: string,
): Array<{ name: string; slice: string; path?: string }> {
  const out: Array<{ name: string; slice: string; path?: string }> = []
  const re = /\btools\s*\.\s*(edit|write|insert)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const toolName = m[1]
    let i = m.index + m[0].length
    let depth = 1
    let inQuote: string | null = null
    while (i < code.length && depth > 0) {
      const ch = code[i]
      if (inQuote) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === inQuote) inQuote = null
        i++
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inQuote = ch
        i++
        continue
      }
      if (ch === '(') depth++
      else if (ch === ')') depth--
      i++
    }
    if (depth === 0) {
      const slice = code.slice(m.index + m[0].length, i - 1)
      const path = extractJsFieldString(slice, 'path') ?? extractJsFieldString(slice, 'file_path')
      out.push({ name: toolName, slice, ...(path ? { path } : {}) })
    }
  }
  return out
}

function statsFromLiteralSlice(
  toolName: string,
  slice: string,
): { path?: string; additions: number; deletions: number } | null {
  const path = extractJsFieldString(slice, 'path') ?? extractJsFieldString(slice, 'file_path')
  if (toolName === 'write' || toolName === 'insert') {
    const content = extractJsFieldString(slice, 'content')
    if (content === undefined) return null
    return { ...(path ? { path } : {}), additions: countTextLines(content), deletions: 0 }
  }
  if (toolName === 'edit') {
    const pairRe = /(?:^|[,\{\s])(?:oldText|"oldText"|'oldText')\s*:/g
    let pm: RegExpExecArray | null
    let additions = 0
    let deletions = 0
    let matched = 0
    while ((pm = pairRe.exec(slice)) !== null) {
      const oldParsed = readJsStringAfterColon(slice, pm.index + pm[0].length)
      if (!oldParsed) continue
      const rest = slice.slice(oldParsed.end)
      const newMatch = /(?:^|[,\{\s])(?:newText|"newText"|'newText')\s*:/.exec(rest)
      if (!newMatch) continue
      const newParsed = readJsStringAfterColon(rest, newMatch.index + newMatch[0].length)
      if (!newParsed) continue
      const s = diffLineStatsFromStrings(oldParsed.value, newParsed.value)
      additions += s.additions
      deletions += s.deletions
      matched++
    }
    if (matched > 0) return { ...(path ? { path } : {}), additions, deletions }
  }
  return null
}

export function parseCodemodeCalls(details: unknown, code?: string): CodemodeNestedCall[] {
  const rec = asRecord(details)
  if (!rec || !Array.isArray(rec.calls)) return []

  const nestedRec = asRecord(rec.nestedCalls)
  const nestedArray = Array.isArray(nestedRec?.calls) ? nestedRec.calls : []
  const nestedById = new Map<string, Record<string, unknown>>()
  for (const rawNested of nestedArray) {
    const nr = asRecord(rawNested)
    if (nr && typeof nr.id === 'string' && nr.id) nestedById.set(nr.id, nr)
  }

  let literalSlices: Array<{ name: string; slice: string; path?: string }> | null = null
  const usedLiteralIndices = new Set<number>()

  const out: CodemodeNestedCall[] = []
  for (let idx = 0; idx < rec.calls.length; idx++) {
    const c = asRecord(rec.calls[idx])
    if (!c || typeof c.name !== 'string') continue
    const status = c.status
    const validStatus =
      status === 'running' || status === 'ok' || status === 'error' || status === 'cancelled'
        ? status
        : 'ok'
    const id = typeof c.id === 'string' ? c.id : ''
    const rawArgs = typeof c.args === 'string' ? c.args : ''
    const matchedNested =
      (id ? nestedById.get(id) : undefined) ??
      (asRecord(nestedArray[idx])?.name === c.name ? asRecord(nestedArray[idx]) : null)
    const nestedArgs = asRecord(matchedNested?.arguments)

    let path = typeof c.path === 'string' && c.path ? c.path : undefined
    let additions = typeof c.additions === 'number' && Number.isFinite(c.additions) ? c.additions : undefined
    let deletions = typeof c.deletions === 'number' && Number.isFinite(c.deletions) ? c.deletions : undefined

    const lower = c.name.toLowerCase()
    if (MUTATE_TOOL_NAMES.has(lower) && validStatus !== 'error' && validStatus !== 'cancelled') {
      if (!path) {
        path =
          str(nestedArgs?.path) ??
          str(nestedArgs?.file_path) ??
          extractCodemodeArgField(rawArgs, 'path') ??
          extractCodemodeArgField(rawArgs, 'file_path')
      }
      if (additions === undefined && deletions === undefined) {
        if (nestedArgs) {
          const computed = computeMutateCallDiffStats(lower, nestedArgs)
          additions = computed.additions
          deletions = computed.deletions
          if (!path && computed.path) path = computed.path
        } else {
          const parsedInline = parseJsonObjectLoose(rawArgs)
          if (parsedInline) {
            const computed = computeMutateCallDiffStats(lower, parsedInline)
            additions = computed.additions
            deletions = computed.deletions
            if (!path && computed.path) path = computed.path
          } else if (code) {
            literalSlices ??= extractLiteralCallSlicesFromCode(code)
            const litIdx = literalSlices.findIndex(
              (lit, li) =>
                !usedLiteralIndices.has(li) &&
                lit.name === lower &&
                (!path || !lit.path || lit.path === path),
            )
            if (litIdx >= 0) {
              usedLiteralIndices.add(litIdx)
              const fromCode = statsFromLiteralSlice(lower, literalSlices[litIdx].slice)
              if (fromCode) {
                additions = fromCode.additions
                deletions = fromCode.deletions
                if (!path && fromCode.path) path = fromCode.path
              }
            }
          }
        }
      }
    }

    out.push({
      id,
      name: c.name,
      args: rawArgs,
      status: validStatus,
      ...(typeof c.durationMs === 'number' && Number.isFinite(c.durationMs) ? { durationMs: c.durationMs } : {}),
      ...(typeof c.error === 'string' && c.error ? { error: c.error } : {}),
      ...(typeof c.cost === 'number' && Number.isFinite(c.cost) ? { cost: c.cost } : {}),
      ...(path ? { path } : {}),
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
      ...(nestedArgs ? { arguments: nestedArgs } : {}),
    })
  }
  return out
}

export function sumCodemodeDiffStats(
  calls: readonly CodemodeNestedCall[],
): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const call of calls) {
    if (call.status === 'error' || call.status === 'cancelled') continue
    additions += call.additions ?? 0
    deletions += call.deletions ?? 0
  }
  return { additions, deletions }
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