import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'

/** One assistant reply's usage (pi `AssistantMessage.usage`). */
type Rec = { key: string; ts: number; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number }
type FileUsage = { mtimeMs: number; size: number; project: string; title: string; created: number; records: Rec[] }

const cache = new Map<string, FileUsage>()
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c: { type?: string; text?: string }) => (c?.type === 'text' ? c.text ?? '' : '')).join(' ')
  return ''
}

/** Usage records of one session file (header cwd, first prompt as title). */
export function scanUsageFile(text: string): Omit<FileUsage, 'mtimeMs' | 'size'> {
  let project = ''
  let title = ''
  let created = 0
  const records: Rec[] = []
  for (const line of text.split('\n')) {
    if (!line || (!line.includes('"usage"') && !line.includes('"session"') && title)) continue
    let e: { type?: string; id?: string; cwd?: string; timestamp?: string | number; message?: { role?: string; content?: unknown; usage?: Record<string, unknown>; model?: string; provider?: string; timestamp?: number } }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type === 'session') {
      project = typeof e.cwd === 'string' ? e.cwd : project
      created = Date.parse(String(e.timestamp ?? '')) || 0
      continue
    }
    const m = e.message
    if (e.type !== 'message' || !m) continue
    if (!title && m.role === 'user') title = textOf(m.content).replace(/\s+/g, ' ').trim().slice(0, 80)
    if (m.role !== 'assistant' || !m.usage) continue
    const u = m.usage
    const cost = u.cost && typeof u.cost === 'object' ? num((u.cost as { total?: unknown }).total) : 0
    const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.parse(String(e.timestamp ?? ''))
    if (!Number.isFinite(ts)) continue
    records.push({
      // Forks copy earlier entries (same id and timestamp) into the new file: this key dedupes them.
      key: `${e.id ?? ''}:${ts}:${m.model ?? ''}`,
      ts,
      model: [m.provider, m.model].filter(Boolean).join('/') || 'unknown',
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      reasoning: num(u.reasoning),
      cost,
    })
  }
  return { project, title, created, records }
}

/** `.jsonl` files in `dir` and one level of sub-folders (pi's per-project layout, or a flat `sessionDir`). */
function jsonlFiles(dir: string, out: Set<string>): void {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const n of names) {
    const p = join(dir, n)
    if (n.endsWith('.jsonl')) out.add(p)
    else {
      try {
        if (statSync(p).isDirectory()) for (const m of readdirSync(p)) if (m.endsWith('.jsonl')) out.add(join(p, m))
      } catch {
        /* skip */
      }
    }
  }
}

/** A custom `sessionDir` from pi's settings.json (the CLI and the desktop both honour it). */
export function customSessionDir(agentDir: string): string | null {
  try {
    const dir = (JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as { sessionDir?: unknown }).sessionDir
    if (typeof dir !== 'string' || !dir.trim()) return null
    const d = dir.trim().replace(/^~(?=$|[\\/])/, homedir())
    return isAbsolute(d) ? d : join(agentDir, d)
  } catch {
    return null
  }
}

/** Every session file pi may have written: `<agentDir>/sessions/<project>/`, plus a custom `sessionDir`. */
function sessionFiles(agentDir: string): string[] {
  const out = new Set<string>()
  jsonlFiles(join(agentDir, 'sessions'), out)
  const custom = customSessionDir(agentDir)
  if (custom) jsonlFiles(custom, out)
  return [...out]
}

/** Refresh the per-file cache: only files whose size or mtime changed are read again. */
export function refreshUsage(agentDir: string): { files: number; read: number } {
  const files = sessionFiles(agentDir)
  const live = new Set(files)
  for (const f of cache.keys()) if (!live.has(f)) cache.delete(f)
  let read = 0
  for (const f of files) {
    let st: { mtimeMs: number; size: number }
    try {
      st = statSync(f)
    } catch {
      continue
    }
    const prev = cache.get(f)
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue
    try {
      cache.set(f, { mtimeMs: st.mtimeMs, size: st.size, ...scanUsageFile(readFileSync(f, 'utf8')) })
      read++
    } catch {
      /* unreadable: skip */
    }
  }
  return { files: files.length, read }
}

const emptyBucket = (): UsageBucket => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, calls: 0 })
function add(b: UsageBucket, r: Rec): void {
  b.input += r.input
  b.output += r.output
  b.cacheRead += r.cacheRead
  b.cacheWrite += r.cacheWrite
  b.reasoning += r.reasoning
  b.cost += r.cost
  b.calls++
}

const DAY = 86_400_000

/** Local calendar day (yyyy-mm-dd) of a timestamp, for a UTC offset in minutes (east positive). */
export function dayOf(ts: number, offsetMin: number): string {
  return new Date(ts + offsetMin * 60_000).toISOString().slice(0, 10)
}

/**
 * Aggregate cached records between `from` and `to` (ms, inclusive start, exclusive end); `from <= 0`
 * means since the first record. Replies copied into forks are counted once, for the oldest session.
 */
export function summarizeUsage(from: number, to: number, offsetMin: number): UsageSummary {
  const total = emptyBucket()
  const days = new Map<string, UsageBucket>()
  const models = new Map<string, UsageBucket>()
  const projects = new Map<string, UsageBucket>()
  const sessions = new Map<string, UsageBucket & { title: string; project: string }>()
  const heat = { calls: new Array<number>(168).fill(0), cost: new Array<number>(168).fill(0), tokens: new Array<number>(168).fill(0) }
  const seen = new Set<string>()
  const files = [...cache].sort((a, b) => a[1].created - b[1].created || a[0].localeCompare(b[0]))
  let first = Infinity
  for (const [, f] of files) for (const r of f.records) if (r.ts < first) first = r.ts
  // "All time": from the local midnight of the first reply.
  const start = from > 0 ? from : Number.isFinite(first) ? Math.floor((first + offsetMin * 60_000) / DAY) * DAY - offsetMin * 60_000 : to - DAY
  for (const [file, f] of files) {
    for (const r of f.records) {
      if (r.ts < start || r.ts >= to || seen.has(r.key)) continue
      seen.add(r.key)
      add(total, r)
      const d = dayOf(r.ts, offsetMin)
      add(days.get(d) ?? days.set(d, emptyBucket()).get(d)!, r)
      add(models.get(r.model) ?? models.set(r.model, emptyBucket()).get(r.model)!, r)
      const p = f.project || '—'
      add(projects.get(p) ?? projects.set(p, emptyBucket()).get(p)!, r)
      if (!sessions.has(file)) sessions.set(file, { ...emptyBucket(), title: f.title, project: f.project })
      add(sessions.get(file)!, r)
      // Weekday (Monday = 0) × local hour.
      const local = new Date(r.ts + offsetMin * 60_000)
      const cell = ((local.getUTCDay() + 6) % 7) * 24 + local.getUTCHours()
      heat.calls[cell]++
      heat.cost[cell] += r.cost
      heat.tokens[cell] += r.input + r.output + r.cacheRead + r.cacheWrite
    }
  }
  // Every day in range, so the charts have no gaps.
  const byDay: UsageSummary['byDay'] = []
  for (let t = start; t < to; t += DAY) {
    const d = dayOf(t, offsetMin)
    if (!byDay.length || byDay[byDay.length - 1].day !== d) byDay.push({ day: d, ...(days.get(d) ?? emptyBucket()) })
  }
  const byCost = (a: UsageBucket, b: UsageBucket) => b.cost - a.cost || b.input + b.output - (a.input + a.output)
  const inputAll = total.input + total.cacheRead + total.cacheWrite
  return {
    from: start,
    to,
    total,
    cacheHitRate: inputAll > 0 ? total.cacheRead / inputAll : null,
    activeDays: days.size,
    sessions: sessions.size,
    firstAt: Number.isFinite(first) ? first : null,
    byDay,
    heat,
    byModel: [...models].map(([model, b]) => ({ model, ...b })).sort(byCost).slice(0, 12),
    byProject: [...projects].map(([project, b]) => ({ project, ...b })).sort(byCost).slice(0, 12),
    topSessions: [...sessions].map(([sessionFile, b]) => ({ sessionFile, ...b })).sort(byCost).slice(0, 10),
  }
}

/** Usage of one session file (phone session panel): read directly, no cache needed. */
export function sessionUsage(file: string): UsageBucket | null {
  try {
    const { records } = scanUsageFile(readFileSync(file, 'utf8'))
    const b = emptyBucket()
    for (const r of records) add(b, r)
    return b
  } catch {
    return null
  }
}

export function __resetUsageCacheForTest(): void {
  cache.clear()
}
