import type { UsageStatsBucket, UsageSummary } from '@shared/usage-summary'

const DAY_MS = 86_400_000

export type ActivityDayCell = {
  day: string
  tokens: number
  calls: number
  cost: number
  future: boolean
}

export type ActivityWeekCol = {
  index: number
  startDay: string
  endDay: string
  month: number | null
  tokens: number
  calls: number
  cost: number
  cells: ActivityDayCell[]
}

export type CumulativePoint = {
  label: string
  month: number | null
  totalTokens: number
  weekTokens: number
}

export type HomeUsageViewModel = {
  totalTokens: number
  peakDailyTokens: number
  longestTaskMs: number | null
  longestStreak: number
  currentStreak: number
  weeks: ActivityWeekCol[]
  maxDayTokens: number
  maxWeekTokens: number
  cumulative: CumulativePoint[]
}

export function bucketTotalTokens(b: Pick<UsageStatsBucket, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite
}

export function formatLocalDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDayMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getTime()
}

function trimTrailingZero(fixed: string): string {
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
}

export function formatHomeTokens(n: number, lang: string): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const isZh = lang.toLowerCase().startsWith('zh')
  if (isZh) {
    if (n >= 100_000_000) return `${trimTrailingZero((n / 100_000_000).toFixed(1))}亿`
    if (n >= 10_000) return `${trimTrailingZero((n / 10_000).toFixed(1))}万`
    return Math.round(n).toLocaleString('zh-CN')
  }
  if (n >= 1_000_000_000) return `${trimTrailingZero((n / 1_000_000_000).toFixed(2))}B`
  if (n >= 1_000_000) return `${trimTrailingZero((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${trimTrailingZero((n / 1_000).toFixed(1))}K`
  return String(Math.round(n))
}

export function formatHomeDuration(ms: number | null | undefined, lang: string): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = Math.max(1, Math.round(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  const lower = lang.toLowerCase()
  if (lower.startsWith('zh')) {
    if (hours > 0) return `${hours} 小时 ${mins} 分`
    if (mins > 0) return secs > 0 ? `${mins} 分 ${secs} 秒` : `${mins} 分`
    return `${secs} 秒`
  }
  if (lower.startsWith('ru')) {
    if (hours > 0) return `${hours} ч ${mins} мин`
    if (mins > 0) return secs > 0 ? `${mins} мин ${secs} с` : `${mins} мин`
    return `${secs} с`
  }
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  return `${secs}s`
}

export function computeUsageStreaks(activeDaysSorted: string[], todayMs: number): { longest: number; current: number } {
  if (activeDaysSorted.length === 0) return { longest: 0, current: 0 }
  let longest = 1
  let run = 1
  for (let i = 1; i < activeDaysSorted.length; i++) {
    const prev = parseLocalDayMs(activeDaysSorted[i - 1])
    const cur = parseLocalDayMs(activeDaysSorted[i])
    const diffDays = Math.round((cur - prev) / DAY_MS)
    run = diffDays === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  const activeSet = new Set(activeDaysSorted)
  const todayStr = formatLocalDay(todayMs)
  const yesterdayStr = formatLocalDay(todayMs - DAY_MS)
  let cursorMs = activeSet.has(todayStr) ? todayMs : activeSet.has(yesterdayStr) ? todayMs - DAY_MS : -1
  let current = 0
  while (cursorMs >= 0 && activeSet.has(formatLocalDay(cursorMs))) {
    current++
    cursorMs -= DAY_MS
  }
  return { longest, current }
}

function buildSingleWeekCol(
  index: number,
  weekStartMs: number,
  todayMidnightMs: number,
  dayMap: Map<string, { tokens: number; calls: number; cost: number }>,
  prevYearMonth: string,
): { col: ActivityWeekCol; nextYearMonth: string } {
  const cells: ActivityDayCell[] = []
  let tokens = 0
  let calls = 0
  let cost = 0
  for (let d = 0; d < 7; d++) {
    const cellMs = weekStartMs + d * DAY_MS
    const day = formatLocalDay(cellMs)
    const future = cellMs > todayMidnightMs
    const hit = future ? undefined : dayMap.get(day)
    tokens += hit?.tokens ?? 0
    calls += hit?.calls ?? 0
    cost += hit?.cost ?? 0
    cells.push({ day, tokens: hit?.tokens ?? 0, calls: hit?.calls ?? 0, cost: hit?.cost ?? 0, future })
  }
  const firstDay = cells[0].day
  const ym = firstDay.slice(0, 7)
  const isNewMonth = !cells[0].future && ym !== prevYearMonth
  const lastReal = [...cells].reverse().find((c) => !c.future) ?? cells[6]
  return {
    nextYearMonth: isNewMonth ? ym : prevYearMonth,
    col: {
      index,
      startDay: firstDay,
      endDay: lastReal.day,
      month: isNewMonth ? Number(firstDay.slice(5, 7)) : null,
      tokens,
      calls,
      cost,
      cells,
    },
  }
}

function buildWeekColumns(
  dayMap: Map<string, { tokens: number; calls: number; cost: number }>,
  todayMidnightMs: number,
  weekCount = 52,
): ActivityWeekCol[] {
  const dow = (new Date(todayMidnightMs).getDay() + 6) % 7
  const firstMondayMs = todayMidnightMs - dow * DAY_MS - (weekCount - 1) * 7 * DAY_MS
  const cols: ActivityWeekCol[] = []
  let prevYearMonth = ''
  for (let w = 0; w < weekCount; w++) {
    const res = buildSingleWeekCol(w, firstMondayMs + w * 7 * DAY_MS, todayMidnightMs, dayMap, prevYearMonth)
    prevYearMonth = res.nextYearMonth
    cols.push(res.col)
  }
  return cols
}

export function buildHomeUsageViewModel(
  summary: UsageSummary | null,
  longestTaskMs: number | null,
  nowMs = Date.now(),
): HomeUsageViewModel {
  const nowDate = new Date(nowMs)
  const todayMidnightMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const dayMap = new Map<string, { tokens: number; calls: number; cost: number }>()
  let peakDailyTokens = 0
  const activeDays: string[] = []

  for (const row of summary?.byDay ?? []) {
    const tokens = bucketTotalTokens(row)
    dayMap.set(row.day, { tokens, calls: row.calls, cost: row.cost })
    if (tokens > peakDailyTokens) peakDailyTokens = tokens
    if (tokens > 0 || row.calls > 0) activeDays.push(row.day)
  }
  activeDays.sort()

  const totalTokens = summary ? bucketTotalTokens(summary.total) : 0
  const streaks = computeUsageStreaks(activeDays, todayMidnightMs)
  const weeks = buildWeekColumns(dayMap, todayMidnightMs, 52)
  const windowTokens = weeks.reduce((sum, w) => sum + w.tokens, 0)
  let runningTotal = Math.max(0, totalTokens - windowTokens)
  let maxDayTokens = 0
  let maxWeekTokens = 0

  const cumulative: CumulativePoint[] = weeks.map((w) => {
    runningTotal += w.tokens
    if (w.tokens > maxWeekTokens) maxWeekTokens = w.tokens
    for (const c of w.cells) {
      if (!c.future && c.tokens > maxDayTokens) maxDayTokens = c.tokens
    }
    return {
      label: w.endDay,
      month: w.month,
      totalTokens: runningTotal,
      weekTokens: w.tokens,
    }
  })

  return {
    totalTokens,
    peakDailyTokens,
    longestTaskMs,
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    weeks,
    maxDayTokens,
    maxWeekTokens,
    cumulative,
  }
}
