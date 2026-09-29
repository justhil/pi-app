/** Calendar math for the gantt block. Days are integer UTC day numbers; task ends are exclusive. */

export const DAY_MS = 86_400_000

export type GanttScale = 'day' | 'week' | 'month'

export type GanttTaskInput = {
  id?: string
  name: string
  start: string
  end?: string
  duration?: number
  progress?: number
  group?: string
  dependsOn?: string | string[]
  milestone?: boolean
}

export type ResolvedTask = {
  key: string
  index: number
  name: string
  group: string | null
  start: number
  /** Exclusive; equals `start` for milestones. */
  end: number
  milestone: boolean
  progress: number | null
  deps: string[]
}

/** "2026-10-01", "2026/10/1", "2026-10-01T09:00" → day number; rejects impossible dates. */
export function parseDay(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return Math.round(date.getTime() / DAY_MS)
}

export function dayParts(day: number): { year: number; month: number; date: number; weekday: number } {
  const date = new Date(day * DAY_MS)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), weekday: date.getUTCDay() }
}

export function localToday(now = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS)
}

function monthStart(year: number, month: number): number {
  return Math.round(Date.UTC(year, month, 1) / DAY_MS)
}

export function resolveTasks(tasks: GanttTaskInput[]): ResolvedTask[] {
  const used = new Set<string>()
  const lookup = new Map<string, string>()
  const base = tasks.map((task, index) => {
    let key = (task.id ?? task.name).trim() || `task-${index}`
    if (used.has(key)) key = `${key}#${index}`
    used.add(key)
    if (task.id && !lookup.has(task.id)) lookup.set(task.id, key)
    if (!lookup.has(task.name)) lookup.set(task.name, key)
    const start = parseDay(task.start) ?? 0
    const endDay = task.end != null ? parseDay(task.end) : undefined
    let end: number
    if (endDay != null) end = endDay + 1
    else if (task.duration != null && Number.isFinite(task.duration)) end = start + Math.max(0, Math.round(task.duration))
    else end = task.milestone ? start : start + 1
    const milestone = task.milestone === true || end === start
    if (milestone) end = start
    else if (end < start) end = start + 1
    const progress =
      task.progress == null || !Number.isFinite(task.progress)
        ? null
        : Math.max(0, Math.min(1, task.progress > 1 ? task.progress / 100 : task.progress))
    return { key, index, name: task.name, group: task.group?.trim() || null, start, end, milestone, progress, raw: task }
  })
  return base.map(({ raw, ...task }) => {
    const wanted = raw.dependsOn == null ? [] : Array.isArray(raw.dependsOn) ? raw.dependsOn : [raw.dependsOn]
    const deps = [...new Set(wanted.map((ref) => lookup.get(String(ref).trim())).filter((ref): ref is string => !!ref && ref !== task.key))]
    return { ...task, deps }
  })
}

export function taskExtent(tasks: ResolvedTask[]): [number, number] {
  if (tasks.length === 0) return [0, 1]
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const task of tasks) {
    min = Math.min(min, task.start)
    max = Math.max(max, task.milestone ? task.start + 1 : task.end)
  }
  return [min, Math.max(max, min + 1)]
}

export function pickScale(spanDays: number): GanttScale {
  if (spanDays <= 35) return 'day'
  if (spanDays <= 200) return 'week'
  return 'month'
}

/** Minimum horizontal density per scale; below it the timeline scrolls instead of cramming labels. */
export const MIN_PX_PER_DAY: Record<GanttScale, number> = { day: 22, week: 7, month: 1.7 }

/** Pad and align the visible range to whole scale units. */
export function scaleDomain(min: number, max: number, scale: GanttScale): [number, number] {
  if (scale === 'day') return [min - 1, max + 1]
  if (scale === 'week') {
    const start = min - ((dayParts(min).weekday + 6) % 7)
    const offset = (dayParts(max).weekday + 6) % 7
    const end = offset === 0 ? max : max + 7 - offset
    return [start, Math.max(end, start + 7)]
  }
  const first = dayParts(min)
  const last = dayParts(max - 1)
  return [monthStart(first.year, first.month), monthStart(last.year, last.month + 1)]
}

export type Cell = { start: number; end: number; label: string; weekend?: boolean }

export type TierFormat = {
  month: (year: number, month: number) => string
  monthYear: (year: number, month: number) => string
}

function monthCells(domain: [number, number], label: (year: number, month: number) => string): Cell[] {
  const cells: Cell[] = []
  let { year, month } = dayParts(domain[0])
  let cursor = domain[0]
  while (cursor < domain[1]) {
    const next = Math.min(domain[1], monthStart(year, month + 1))
    cells.push({ start: cursor, end: next, label: label(year, month) })
    cursor = next
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  return cells
}

/** Two header tiers: months over days/weeks, or years over months. */
export function buildTiers(domain: [number, number], scale: GanttScale, format: TierFormat): { top: Cell[]; bottom: Cell[] } {
  if (scale === 'month') {
    const bottom = monthCells(domain, format.month)
    const top: Cell[] = []
    for (const cell of bottom) {
      const year = String(dayParts(cell.start).year)
      const last = top[top.length - 1]
      if (last && last.label === year) last.end = cell.end
      else top.push({ start: cell.start, end: cell.end, label: year })
    }
    return { top, bottom }
  }
  const top = monthCells(domain, format.monthYear)
  const bottom: Cell[] = []
  if (scale === 'day') {
    for (let day = domain[0]; day < domain[1]; day += 1) {
      const parts = dayParts(day)
      bottom.push({ start: day, end: day + 1, label: String(parts.date), weekend: parts.weekday === 0 || parts.weekday === 6 })
    }
  } else {
    for (let day = domain[0]; day < domain[1]; day += 7) {
      const parts = dayParts(day)
      bottom.push({ start: day, end: Math.min(domain[1], day + 7), label: `${parts.month + 1}/${parts.date}` })
    }
  }
  return { top, bottom }
}

/** Weekend runs (Sat+Sun) inside the domain, merged into single stripes. */
export function weekendRuns(domain: [number, number]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  for (let day = domain[0]; day < domain[1]; day += 1) {
    const weekday = dayParts(day).weekday
    if (weekday !== 0 && weekday !== 6) continue
    const last = runs[runs.length - 1]
    if (last && last[1] === day) last[1] = day + 1
    else runs.push([day, day + 1])
  }
  return runs
}

export type GanttRow =
  | { kind: 'group'; name: string; start: number; end: number; progress: number | null; count: number; collapsed: boolean }
  | { kind: 'task'; task: ResolvedTask; grouped: boolean }

/** Tasks in source order; a group's tasks are gathered under its header at the first appearance. */
export function buildRows(tasks: ResolvedTask[], collapsed: readonly string[]): GanttRow[] {
  const members = new Map<string, ResolvedTask[]>()
  for (const task of tasks) {
    if (!task.group) continue
    const list = members.get(task.group)
    if (list) list.push(task)
    else members.set(task.group, [task])
  }
  const rows: GanttRow[] = []
  const emitted = new Set<string>()
  for (const task of tasks) {
    if (!task.group) {
      rows.push({ kind: 'task', task, grouped: false })
      continue
    }
    if (emitted.has(task.group)) continue
    emitted.add(task.group)
    const list = members.get(task.group)!
    let weighted = 0
    let weight = 0
    for (const member of list) {
      if (member.progress == null) continue
      const span = Math.max(1, member.end - member.start)
      weighted += member.progress * span
      weight += span
    }
    const isCollapsed = collapsed.includes(task.group)
    rows.push({
      kind: 'group',
      name: task.group,
      start: Math.min(...list.map((member) => member.start)),
      end: Math.max(...list.map((member) => (member.milestone ? member.start : member.end))),
      progress: weight ? weighted / weight : null,
      count: list.length,
      collapsed: isCollapsed,
    })
    if (!isCollapsed) for (const member of list) rows.push({ kind: 'task', task: member, grouped: true })
  }
  return rows
}

/** Everything upstream and downstream of `key` through dependency edges (including `key`). */
export function dependencyChain(tasks: ResolvedTask[], key: string): Set<string> {
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    for (const dep of task.deps) {
      const list = dependents.get(dep)
      if (list) list.push(task.key)
      else dependents.set(dep, [task.key])
    }
  }
  const chain = new Set<string>([key])
  const walk = (start: string, next: (at: string) => string[]) => {
    const queue = [start]
    while (queue.length) {
      const at = queue.pop()!
      for (const neighbour of next(at)) {
        if (chain.has(neighbour)) continue
        chain.add(neighbour)
        queue.push(neighbour)
      }
    }
  }
  walk(key, (at) => byKey.get(at)?.deps ?? [])
  walk(key, (at) => dependents.get(at) ?? [])
  return chain
}

/** Orthogonal connector from a predecessor's end to a successor's start (px space). */
export function connectorPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const gap = 8
  if (x2 - x1 >= gap * 2) {
    const mid = x1 + gap
    return `M${x1},${y1} H${mid} V${y2} H${x2}`
  }
  const lane = y2 > y1 ? y2 - rowHeight / 2 : y2 + rowHeight / 2
  return `M${x1},${y1} H${x1 + gap} V${lane} H${x2 - gap} V${y2} H${x2}`
}
