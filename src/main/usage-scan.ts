import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type {
  UsageBucket,
  UsageCostBreakdown,
  UsageLogPage,
  UsageLogQuery,
  UsageLogRow,
  UsageLogSortField,
  UsageStatsBucket,
  UsageStopStatus,
  UsageSummary,
} from '@shared/usage-summary'

/** One assistant reply's usage & latency metadata from a session `.jsonl` line. */
type Rec = {
  key: string
  entryId: string
  parentId: string | null
  ts: number
  api: string
  provider: string
  modelId: string
  model: string
  responseModel?: string
  responseId?: string
  thinkingLevel?: string
  stopReason: string
  status: UsageStopStatus
  errorMessage?: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  reasoning: number
  cost: number
  costBreakdown: UsageCostBreakdown & { totalFromProvider?: boolean }
  durationMs: number | null
  ttftMs: number | null
  firstTokenKind?: 'thinking' | 'text' | 'toolCall'
}

type FileUsage = {
  mtimeMs: number
  size: number
  project: string
  title: string
  created: number
  records: Rec[]
}

const DAY = 86_400_000
const MAX_FALLBACK_DURATION_MS = 3_600_000
const cache = new Map<string, FileUsage>()

export function __resetUsageCacheForTest(): void {
  cache.clear()
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function firstUserLine(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  for (const part of content) {
    if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
      const t = (part as { text?: unknown }).text
      if (typeof t === 'string' && t.trim()) return t
    }
  }
  return ''
}

function classifyStopStatus(stopReason: string): UsageStopStatus {
  if (stopReason === 'error') return 'error'
  if (stopReason === 'aborted') return 'aborted'
  if (stopReason === 'length') return 'length'
  return 'ok'
}

function parseFirstTokenKind(v: unknown): 'thinking' | 'text' | 'toolCall' | undefined {
  return v === 'thinking' || v === 'text' || v === 'toolCall' ? v : undefined
}

export function scanUsageFile(raw: string): Omit<FileUsage, 'mtimeMs' | 'size'> {
  let project = ''
  let title = ''
  let named = ''
  let created = Infinity
  const records: Rec[] = []
  let lineIdx = 0

  for (let start = 0; start < raw.length; ) {
    const nl = raw.indexOf('\n', start)
    const line = raw.slice(start, nl < 0 ? raw.length : nl).trim()
    start = nl < 0 ? raw.length : nl + 1
    const currentLine = lineIdx++
    if (!line) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (e.type === 'session') {
      if (typeof e.cwd === 'string') project = e.cwd
      const t = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN
      if (Number.isFinite(t)) created = t
      continue
    }
    if (e.type === 'session_info' && typeof e.name === 'string' && e.name.trim()) {
      named = e.name.trim()
      continue
    }
    if (e.type !== 'message' || !e.message || typeof e.message !== 'object') continue
    const m = e.message as Record<string, unknown>
    if (m.role === 'user' && !title) {
      title = firstUserLine(m.content).replace(/\s+/g, ' ').trim().slice(0, 80)
      continue
    }
    if (m.role !== 'assistant' || !m.usage || typeof m.usage !== 'object') continue
    const u = m.usage as Record<string, unknown>
    const c = u.cost && typeof u.cost === 'object' ? (u.cost as Record<string, unknown>) : undefined
    const msgTs = typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) ? m.timestamp : NaN
    const entryTs = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : NaN
    const ts = Number.isFinite(msgTs) ? msgTs : entryTs
    if (!Number.isFinite(ts)) continue

    const provider = typeof m.provider === 'string' ? m.provider : ''
    const modelId = typeof m.model === 'string' ? m.model : 'unknown'
    const rawEntryId = typeof e.id === 'string' && e.id ? e.id : ''
    const entryId = rawEntryId || `@line:${currentLine}`
    const parentId = typeof e.parentId === 'string' ? e.parentId : null

    let durationMs: number | null = null
    if (typeof m.durationMs === 'number' && Number.isFinite(m.durationMs) && m.durationMs >= 0) {
      durationMs = Math.round(m.durationMs)
    } else if (Number.isFinite(entryTs) && Number.isFinite(msgTs) && entryTs >= msgTs) {
      const delta = Math.round(entryTs - msgTs)
      if (delta <= MAX_FALLBACK_DURATION_MS) durationMs = delta
    }

    const rawTtft =
      typeof m.ttftMs === 'number' && Number.isFinite(m.ttftMs) && m.ttftMs >= 0
        ? Math.round(m.ttftMs)
        : null
    const ttftMs =
      rawTtft !== null && durationMs !== null ? Math.min(rawTtft, durationMs) : rawTtft

    const stopReason = typeof m.stopReason === 'string' && m.stopReason ? m.stopReason : 'stop'
    const respModel =
      typeof m.responseModel === 'string' && m.responseModel && m.responseModel !== modelId
        ? m.responseModel
        : undefined
    const responseId = typeof m.responseId === 'string' && m.responseId ? m.responseId : undefined
    const thinkingLevel =
      typeof m.thinkingLevel === 'string' && m.thinkingLevel && m.thinkingLevel !== 'off'
        ? m.thinkingLevel
        : typeof m.providerThinkingLevel === 'string' && m.providerThinkingLevel
          ? m.providerThinkingLevel
          : undefined
    const errorMessage =
      typeof m.errorMessage === 'string' && m.errorMessage.trim()
        ? m.errorMessage.trim().slice(0, 240)
        : undefined

    records.push({
      key: `${rawEntryId}@${ts}`,
      entryId,
      parentId,
      ts,
      api: typeof m.api === 'string' ? m.api : '',
      provider,
      modelId,
      model: provider ? `${provider}/${modelId}` : modelId,
      ...(respModel ? { responseModel: respModel } : {}),
      ...(responseId ? { responseId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      stopReason,
      status: classifyStopStatus(stopReason),
      ...(errorMessage ? { errorMessage } : {}),
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      cacheWrite1h: num(u.cacheWrite1h),
      reasoning: num(u.reasoning),
      cost: num(c?.total),
      costBreakdown: {
        input: num(c?.input),
        output: num(c?.output),
        cacheRead: num(c?.cacheRead),
        cacheWrite: num(c?.cacheWrite),
        ...(typeof c?.totalFromProvider === 'boolean' ? { totalFromProvider: c.totalFromProvider } : {}),
      },
      durationMs,
      ttftMs,
      ...(parseFirstTokenKind(m.firstTokenKind) ? { firstTokenKind: parseFirstTokenKind(m.firstTokenKind) } : {}),
    })
  }
  if (!Number.isFinite(created)) created = records[0]?.ts ?? 0
  return { project, title: named || title, created, records }
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/** Directories where pi stores `.jsonl` sessions: `<agentDir>/sessions/*` plus optional `sessionDir` in settings. */
export function resolveSessionRoots(agentDir: string): string[] {
  const roots = [join(agentDir, 'sessions')]
  try {
    const s = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as { sessionDir?: unknown }
    if (typeof s.sessionDir === 'string' && s.sessionDir.trim()) {
      const p = expandHome(s.sessionDir.trim())
      roots.push(isAbsolute(p) ? p : join(agentDir, p))
    }
  } catch {
    /* optional */
  }
  return [...new Set(roots)]
}

function listJsonl(roots: readonly string[]): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of entries) {
      const full = join(dir, d.name)
      if (d.isDirectory() && depth < 2) walk(full, depth + 1)
      else if (d.isFile() && d.name.endsWith('.jsonl')) out.push(full)
    }
  }
  for (const r of roots) walk(r, 0)
  return out
}

export function refreshUsage(agentDir: string): { files: number; read: number } {
  const files = listJsonl(resolveSessionRoots(agentDir))
  const live = new Set(files)
  for (const k of cache.keys()) if (!live.has(k)) cache.delete(k)
  let read = 0
  for (const file of files) {
    let st
    try {
      st = statSync(file)
    } catch {
      cache.delete(file)
      continue
    }
    const prev = cache.get(file)
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
    try {
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, ...scanUsageFile(readFileSync(file, 'utf8')) })
      read++
    } catch {
      cache.delete(file)
    }
  }
  return { files: files.length, read }
}

const emptyBucket = (): UsageBucket => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0,
  calls: 0,
})

function addSimple(b: UsageBucket, r: Rec): void {
  b.input += r.input
  b.output += r.output
  b.cacheRead += r.cacheRead
  b.cacheWrite += r.cacheWrite
  b.reasoning += r.reasoning
  b.cost += r.cost
  b.calls += 1
}

function streamedGenTokensOf(r: Rec): number {
  if (r.firstTokenKind && r.firstTokenKind !== 'thinking' && r.reasoning > 0) {
    return Math.max(0, r.output - r.reasoning)
  }
  return r.output
}

function calcRowTotalTps(r: Rec): number | null {
  if (r.durationMs == null || r.durationMs <= 0 || r.output <= 0) return null
  return r.output / (r.durationMs / 1000)
}

function calcRowGenTps(r: Rec): number | null {
  if (r.ttftMs == null || r.durationMs == null) return null
  const tokens = streamedGenTokensOf(r)
  if (tokens <= 0) return null
  const decodeMs = Math.max(r.durationMs - r.ttftMs, 100)
  return tokens / (decodeMs / 1000)
}

type StatsAcc = {
  bucket: UsageBucket
  cacheWrite1h: number
  costBreakdown: UsageCostBreakdown
  successCalls: number
  errorCalls: number
  abortedCalls: number
  lengthCalls: number
  durations: number[]
  ttfts: number[]
  validOutputTokens: number
  validDurationSec: number
  validGenTokens: number
  validGenSec: number
}

function createAcc(): StatsAcc {
  return {
    bucket: emptyBucket(),
    cacheWrite1h: 0,
    costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    successCalls: 0,
    errorCalls: 0,
    abortedCalls: 0,
    lengthCalls: 0,
    durations: [],
    ttfts: [],
    validOutputTokens: 0,
    validDurationSec: 0,
    validGenTokens: 0,
    validGenSec: 0,
  }
}

function addAcc(acc: StatsAcc, r: Rec): void {
  addSimple(acc.bucket, r)
  acc.cacheWrite1h += r.cacheWrite1h
  acc.costBreakdown.input += r.costBreakdown.input
  acc.costBreakdown.output += r.costBreakdown.output
  acc.costBreakdown.cacheRead += r.costBreakdown.cacheRead
  acc.costBreakdown.cacheWrite += r.costBreakdown.cacheWrite

  if (r.status === 'error') {
    acc.errorCalls++
    return
  }
  if (r.status === 'aborted') {
    acc.abortedCalls++
    return
  }
  if (r.status === 'length') acc.lengthCalls++
  acc.successCalls++

  // Latency & TPS averages exclude error/aborted calls so partial failures do not skew throughput.
  if (r.durationMs != null && r.durationMs > 0) {
    acc.durations.push(r.durationMs)
    if (r.output > 0) {
      acc.validOutputTokens += r.output
      acc.validDurationSec += r.durationMs / 1000
    }
  }
  if (r.ttftMs != null) {
    acc.ttfts.push(r.ttftMs)
    if (r.durationMs != null) {
      const genTokens = streamedGenTokensOf(r)
      if (genTokens > 0) {
        acc.validGenTokens += genTokens
        acc.validGenSec += Math.max(r.durationMs - r.ttftMs, 100) / 1000
      }
    }
  }
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
}

function mean(vals: readonly number[]): number | null {
  if (vals.length === 0) return null
  let sum = 0
  for (const v of vals) sum += v
  return Math.round(sum / vals.length)
}

function finalizeAcc(acc: StatsAcc): UsageStatsBucket {
  const promptTotal = acc.bucket.input + acc.bucket.cacheRead + acc.bucket.cacheWrite
  const sortedDur = acc.durations.length > 1 ? [...acc.durations].sort((a, b) => a - b) : acc.durations
  const sortedTtft = acc.ttfts.length > 1 ? [...acc.ttfts].sort((a, b) => a - b) : acc.ttfts

  return {
    ...acc.bucket,
    cacheWrite1h: acc.cacheWrite1h,
    costBreakdown: acc.costBreakdown,
    successCalls: acc.successCalls,
    errorCalls: acc.errorCalls,
    abortedCalls: acc.abortedCalls,
    lengthCalls: acc.lengthCalls,
    cacheHitRate: promptTotal > 0 ? acc.bucket.cacheRead / promptTotal : null,
    writeCacheRate: promptTotal > 0 ? acc.bucket.cacheWrite / promptTotal : null,
    durationCalls: acc.durations.length,
    avgDurationMs: mean(acc.durations),
    p50DurationMs: quantile(sortedDur, 0.5),
    ttftCalls: acc.ttfts.length,
    avgTtftMs: mean(acc.ttfts),
    p50TtftMs: quantile(sortedTtft, 0.5),
    p90TtftMs: quantile(sortedTtft, 0.9),
    totalTps: acc.validDurationSec > 0 ? acc.validOutputTokens / acc.validDurationSec : null,
    genTps: acc.validGenSec > 0 ? acc.validGenTokens / acc.validGenSec : null,
  }
}

/** Local YYYY-MM-DD for `ts` given `offsetMin` = minutes ahead of UTC (`-Date.getTimezoneOffset()`). */
export function dayOf(ts: number, offsetMin: number): string {
  const d = new Date(ts + offsetMin * 60_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function sortedCachedFiles(): [string, FileUsage][] {
  return [...cache].sort((a, b) => a[1].created - b[1].created || a[0].localeCompare(b[0]))
}

/**
 * Aggregate cached records between `from` and `to` (ms, inclusive start, exclusive end); `from <= 0`
 * means since the first record. Replies copied into forks are counted once, for the oldest session.
 */
export function summarizeUsage(from: number, to: number, offsetMin: number): UsageSummary {
  const totalAcc = createAcc()
  const days = new Map<string, StatsAcc>()
  const models = new Map<string, { acc: StatsAcc; provider: string; modelId: string }>()
  const projects = new Map<string, StatsAcc>()
  const sessions = new Map<string, { acc: StatsAcc; title: string; project: string }>()
  const heat = {
    calls: new Array<number>(168).fill(0),
    cost: new Array<number>(168).fill(0),
    tokens: new Array<number>(168).fill(0),
  }
  const seen = new Set<string>()
  const files = sortedCachedFiles()
  let first = Infinity
  for (const [, f] of files) for (const r of f.records) if (r.ts < first) first = r.ts
  const start = from > 0 ? from : Number.isFinite(first) ? first - ((first + offsetMin * 60_000) % DAY + DAY) % DAY : to

  for (const [path, f] of files) {
    for (const r of f.records) {
      // A reply without an entry id cannot be matched across files; keep it rather than drop real spend.
      if (!r.key.startsWith('@')) {
        if (seen.has(r.key)) continue
        seen.add(r.key)
      }
      if (r.ts < start || r.ts >= to) continue
      const day = dayOf(r.ts, offsetMin)
      addAcc(totalAcc, r)

      let dayAcc = days.get(day)
      if (!dayAcc) {
        dayAcc = createAcc()
        days.set(day, dayAcc)
      }
      addAcc(dayAcc, r)

      let modelEntry = models.get(r.model)
      if (!modelEntry) {
        modelEntry = { acc: createAcc(), provider: r.provider, modelId: r.modelId }
        models.set(r.model, modelEntry)
      }
      addAcc(modelEntry.acc, r)

      const proj = f.project || '(unknown)'
      let projAcc = projects.get(proj)
      if (!projAcc) {
        projAcc = createAcc()
        projects.set(proj, projAcc)
      }
      addAcc(projAcc, r)

      let sessEntry = sessions.get(path)
      if (!sessEntry) {
        sessEntry = { acc: createAcc(), title: f.title, project: proj }
        sessions.set(path, sessEntry)
      }
      addAcc(sessEntry.acc, r)

      const loc = new Date(r.ts + offsetMin * 60_000)
      const cell = ((loc.getUTCDay() + 6) % 7) * 24 + loc.getUTCHours()
      heat.calls[cell] += 1
      heat.cost[cell] += r.cost
      heat.tokens[cell] += r.input + r.output + r.cacheRead + r.cacheWrite
    }
  }

  const emptyStats = finalizeAcc(createAcc())
  const byDay: UsageSummary['byDay'] = []
  for (let t = start; t < to; t += DAY) {
    const d = dayOf(t, offsetMin)
    if (!byDay.length || byDay[byDay.length - 1].day !== d) {
      const acc = days.get(d)
      byDay.push({ day: d, ...(acc ? finalizeAcc(acc) : emptyStats) })
    }
  }

  const byCost = (a: UsageBucket, b: UsageBucket) =>
    b.cost - a.cost || b.input + b.output - (a.input + a.output)
  const finalizedTotal = finalizeAcc(totalAcc)

  return {
    from: start,
    to,
    total: finalizedTotal,
    cacheHitRate: finalizedTotal.cacheHitRate,
    activeDays: days.size,
    sessions: sessions.size,
    firstAt: Number.isFinite(first) ? first : null,
    byDay,
    heat,
    byModel: [...models]
      .map(([model, v]) => ({ model, provider: v.provider, modelId: v.modelId, ...finalizeAcc(v.acc) }))
      .sort(byCost),
    byProject: [...projects]
      .map(([project, acc]) => ({ project, ...finalizeAcc(acc) }))
      .sort(byCost),
    topSessions: [...sessions]
      .map(([sessionFile, v]) => ({ sessionFile, title: v.title, project: v.project, ...finalizeAcc(v.acc) }))
      .sort(byCost)
      .slice(0, 10),
  }
}

function toLogRow(sessionFile: string, f: FileUsage, r: Rec): UsageLogRow {
  const promptTotal = r.input + r.cacheRead + r.cacheWrite
  const totalTokens = promptTotal + r.output
  return {
    id: `${sessionFile}::${r.entryId}`,
    sessionFile,
    entryId: r.entryId,
    parentId: r.parentId,
    sessionTitle: f.title,
    project: f.project || '(unknown)',
    ts: r.ts,
    api: r.api,
    provider: r.provider,
    model: r.model,
    modelId: r.modelId,
    ...(r.responseModel ? { responseModel: r.responseModel } : {}),
    ...(r.responseId ? { responseId: r.responseId } : {}),
    ...(r.thinkingLevel ? { thinkingLevel: r.thinkingLevel } : {}),
    stopReason: r.stopReason,
    status: r.status,
    ...(r.errorMessage ? { errorMessage: r.errorMessage } : {}),
    input: r.input,
    output: r.output,
    reasoning: r.reasoning,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    cacheWrite1h: r.cacheWrite1h,
    totalTokens,
    cacheHitRate: promptTotal > 0 ? r.cacheRead / promptTotal : null,
    writeCacheRate: promptTotal > 0 ? r.cacheWrite / promptTotal : null,
    cost: r.cost,
    costBreakdown: r.costBreakdown,
    durationMs: r.durationMs,
    ttftMs: r.ttftMs,
    ...(r.firstTokenKind ? { firstTokenKind: r.firstTokenKind } : {}),
    totalTps: calcRowTotalTps(r),
    genTps: calcRowGenTps(r),
  }
}

function sortMetricOf(row: UsageLogRow, field: UsageLogSortField): number {
  switch (field) {
    case 'ts':
      return row.ts
    case 'tokens':
      return row.totalTokens
    case 'cacheRead':
      return row.cacheRead
    case 'cacheWrite':
      return row.cacheWrite
    case 'duration':
      return row.durationMs ?? -1
    case 'ttft':
      return row.ttftMs ?? -1
    case 'tps':
      return row.genTps ?? row.totalTps ?? -1
    case 'cost':
      return row.cost
  }
}

export type QueryUsageLogsInput = Omit<UsageLogQuery, 'days'> & {
  from: number
  to: number
}

export function queryUsageLogs(input: QueryUsageLogsInput): UsageLogPage {
  const seen = new Set<string>()
  const files = sortedCachedFiles()
  const start = input.from > 0 ? input.from : 0
  const to = input.to

  const modelSet = new Set<string>()
  const projectSet = new Set<string>()
  const apiSet = new Set<string>()
  const windowRows: UsageLogRow[] = []

  const qSearch = input.search?.trim().toLowerCase() || ''
  const qModel = input.model?.trim() || ''
  const qProject = input.project?.trim() || ''
  const qApi = input.api?.trim() || ''
  const qStatus = input.status && input.status !== 'all' ? input.status : ''

  for (const [sessionFile, f] of files) {
    const proj = f.project || '(unknown)'
    for (const r of f.records) {
      if (!r.key.startsWith('@')) {
        if (seen.has(r.key)) continue
        seen.add(r.key)
      }
      if (r.ts < start || r.ts >= to) continue

      modelSet.add(r.model)
      projectSet.add(proj)
      if (r.api) apiSet.add(r.api)

      if (qModel && r.model !== qModel) continue
      if (qProject && proj !== qProject) continue
      if (qApi && r.api !== qApi) continue
      if (qStatus && r.status !== qStatus) continue
      if (qSearch) {
        const hay = `${r.model} ${r.responseModel || ''} ${f.title} ${proj} ${r.responseId || ''} ${r.errorMessage || ''}`.toLowerCase()
        if (!hay.includes(qSearch)) continue
      }
      windowRows.push(toLogRow(sessionFile, f, r))
    }
  }

  const sortBy: UsageLogSortField = input.sortBy || 'ts'
  const mul = input.sortDir === 'asc' ? 1 : -1
  windowRows.sort((a, b) => {
    const diff = sortMetricOf(a, sortBy) - sortMetricOf(b, sortBy)
    if (diff !== 0) return diff * mul
    return (b.ts - a.ts) || a.id.localeCompare(b.id)
  })

  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)))

  return {
    totalCount: windowRows.length,
    offset,
    limit,
    rows: windowRows.slice(offset, offset + limit),
    facets: {
      models: [...modelSet].sort(),
      projects: [...projectSet].sort(),
      apis: [...apiSet].sort(),
    },
  }
}

/** Usage of one session file (phone session panel): read directly, no cache needed. */
export function sessionUsage(file: string): UsageBucket | null {
  try {
    const { records } = scanUsageFile(readFileSync(file, 'utf8'))
    const b = emptyBucket()
    for (const r of records) addSimple(b, r)
    return b
  } catch {
    return null
  }
}
