import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'

/** One assistant reply's usage (pi `AssistantMessage.usage`). */
type Rec = { ts: number; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
type FileUsage = { mtimeMs: number; size: number; project: string; title: string; records: Rec[] }

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
  const records: Rec[] = []
  for (const line of text.split('\n')) {
    if (!line || (!line.includes('"usage"') && !line.includes('"session"') && title)) continue
    let e: { type?: string; cwd?: string; timestamp?: string | number; message?: { role?: string; content?: unknown; usage?: Record<string, unknown>; model?: string; provider?: string; timestamp?: number } }
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type === 'session') {
      project = typeof e.cwd === 'string' ? e.cwd : project
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
      ts,
      model: [m.provider, m.model].filter(Boolean).join('/') || 'unknown',
      input: num(u.input),
      output: num(u.output),
      cacheRead: num(u.cacheRead),
      cacheWrite: num(u.cacheWrite),
      cost,
    })
  }
  return { project, title, records }
}

/** Every session file under `<agentDir>/sessions/<project dir>/`. */
function sessionFiles(agentDir: string): string[] {
  const root = join(agentDir, 'sessions')
  const out: string[] = []
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    return out
  }
  for (const d of dirs) {
    let names: string[] = []
    try {
      names = readdirSync(join(root, d))
    } catch {
      continue
    }
    for (const n of names) if (n.endsWith('.jsonl')) out.push(join(root, d, n))
  }
  return out
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

const emptyBucket = (): UsageBucket => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, calls: 0 })
function add(b: UsageBucket, r: Rec): void {
  b.input += r.input
  b.output += r.output
  b.cacheRead += r.cacheRead
  b.cacheWrite += r.cacheWrite
  b.cost += r.cost
  b.calls++
}

/** Local calendar day (yyyy-mm-dd) of a timestamp, for a UTC offset in minutes (east positive). */
export function dayOf(ts: number, offsetMin: number): string {
  return new Date(ts + offsetMin * 60_000).toISOString().slice(0, 10)
}

/** Aggregate cached records between `from` and `to` (ms, inclusive start, exclusive end). */
export function summarizeUsage(from: number, to: number, offsetMin: number): UsageSummary {
  const total = emptyBucket()
  const days = new Map<string, UsageBucket>()
  const models = new Map<string, UsageBucket>()
  const projects = new Map<string, UsageBucket>()
  const sessions = new Map<string, UsageBucket & { title: string; project: string }>()
  for (const [file, f] of cache) {
    for (const r of f.records) {
      if (r.ts < from || r.ts >= to) continue
      add(total, r)
      const d = dayOf(r.ts, offsetMin)
      add(days.get(d) ?? days.set(d, emptyBucket()).get(d)!, r)
      add(models.get(r.model) ?? models.set(r.model, emptyBucket()).get(r.model)!, r)
      const p = f.project || '—'
      add(projects.get(p) ?? projects.set(p, emptyBucket()).get(p)!, r)
      if (!sessions.has(file)) sessions.set(file, { ...emptyBucket(), title: f.title, project: f.project })
      add(sessions.get(file)!, r)
    }
  }
  // Every day in range, so the chart has no gaps.
  const byDay: UsageSummary['byDay'] = []
  for (let t = from; t < to; t += 86_400_000) {
    const d = dayOf(t, offsetMin)
    if (!byDay.length || byDay[byDay.length - 1].day !== d) byDay.push({ day: d, ...(days.get(d) ?? emptyBucket()) })
  }
  const byCost = (a: UsageBucket, b: UsageBucket) => b.cost - a.cost || b.input + b.output - (a.input + a.output)
  const inputAll = total.input + total.cacheRead + total.cacheWrite
  return {
    from,
    to,
    total,
    cacheHitRate: inputAll > 0 ? total.cacheRead / inputAll : null,
    byDay,
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
