import { describe, expect, it } from 'vitest'
import { arcPath, labelStep, niceScale, seriesExtent, stackSeries } from '../components/chart-math'
import {
  buildRows,
  buildTiers,
  connectorPath,
  dependencyChain,
  parseDay,
  pickScale,
  resolveTasks,
  scaleDomain,
  taskExtent,
  weekendRuns,
  dayParts,
} from '../components/gantt-math'
import { buildDiffRows, diffSequences, diffWords } from '../components/line-diff'
import { resolveAnswer, stripLetterPrefixes } from '../components/quiz'

describe('chart math', () => {
  it('rounds extents to readable ticks', () => {
    expect(niceScale(0, 97)).toEqual({ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100] })
    expect(niceScale(-3, 7, 5).ticks).toEqual([-4, -2, 0, 2, 4, 6, 8])
    expect(niceScale(5, 5).ticks.length).toBeGreaterThan(1)
    expect(niceScale(0.1, 0.35, 5).ticks).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35])
  })

  it('stacks positive and negative values apart', () => {
    expect(stackSeries([[1, -2, null], [3, -1, 4]])).toEqual([
      [[0, 1], [0, -2], null],
      [[1, 4], [-2, -3], [0, 4]],
    ])
    expect(seriesExtent([[1, -2], [3, -1]], true, true)).toEqual([-3, 4])
    expect(seriesExtent([[5, 7]], false, false)).toEqual([5, 7])
    expect(seriesExtent([[5, 7]], false, true)).toEqual([0, 7])
  })

  it('thins labels to fit the plot width', () => {
    const labels = Array.from({ length: 30 }, (_, index) => `Label ${index}`)
    expect(labelStep(labels, 900)).toBe(3)
    expect(labelStep(['a', 'b'], 900)).toBe(1)
  })

  it('draws donut slices as closed ring segments', () => {
    const path = arcPath(50, 50, 40, 20, 0, Math.PI / 2)
    expect(path.startsWith('M50.00,10.00')).toBe(true)
    expect(path).toContain('A20,20 0 0 0')
    expect(path.endsWith('Z')).toBe(true)
  })
})

describe('line diff', () => {
  const apply = (a: string[], b: string[]) => {
    const ops = diffSequences(a, b)
    const rebuiltA = ops.filter((op) => op.type !== 'insert').map((op) => a[op.a])
    const rebuiltB = ops.filter((op) => op.type !== 'delete').map((op) => (op.type === 'insert' ? b[op.b] : a[op.a]))
    return { ops, rebuiltA, rebuiltB }
  }

  it('produces a minimal edit script that rebuilds both sides', () => {
    const a = ['a', 'b', 'c', 'e', 'f']
    const b = ['a', 'c', 'd', 'e', 'f', 'g']
    const { ops, rebuiltA, rebuiltB } = apply(a, b)
    expect(rebuiltA).toEqual(a)
    expect(rebuiltB).toEqual(b)
    expect(ops.filter((op) => op.type !== 'equal')).toHaveLength(3)
  })

  it('handles empty sides', () => {
    expect(apply([], ['x']).rebuiltB).toEqual(['x'])
    expect(apply(['x'], []).ops).toEqual([{ type: 'delete', a: 0, b: -1 }])
  })

  it('highlights changed words', () => {
    const { before, after } = diffWords('const a = 1', 'const b = 1')
    expect(before).toEqual([
      { text: 'const ', changed: false },
      { text: 'a', changed: true },
      { text: ' = 1', changed: false },
    ])
    expect(after.find((segment) => segment.changed)?.text).toBe('b')
  })

  it('folds long unchanged runs and counts changes', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 10', 'line ten')
    const model = buildDiffRows(before, after)
    expect(model).toMatchObject({ added: 1, removed: 1 })
    const folds = model.rows.filter((row) => row.kind === 'fold')
    expect(folds).toHaveLength(2)
    expect(folds.map((row) => (row.kind === 'fold' ? row.count : 0))).toEqual([7, 6])
    const del = model.rows.find((row) => row.kind === 'del')
    expect(del && 'segments' in del ? del.segments?.some((segment) => segment.changed) : false).toBe(true)
  })
})

describe('gantt math', () => {
  it('parses calendar dates and rejects impossible ones', () => {
    expect(parseDay('2026-10-01')).toBe(Date.UTC(2026, 9, 1) / 86_400_000)
    expect(parseDay('2026/1/5')).toBe(Date.UTC(2026, 0, 5) / 86_400_000)
    expect(parseDay('2026-02-30')).toBeUndefined()
    expect(parseDay('next week')).toBeUndefined()
  })

  it('resolves ends, milestones, progress and dependencies', () => {
    const tasks = resolveTasks([
      { id: 'a', name: 'Design', start: '2026-10-01', end: '2026-10-03', progress: 50 },
      { name: 'Build', start: '2026-10-04', duration: 5, dependsOn: 'a', group: 'Dev' },
      { id: 'ship', name: 'Ship', start: '2026-10-10', milestone: true, dependsOn: ['Build', 'missing', 'ship'] },
    ])
    const day = parseDay('2026-10-01')!
    expect(tasks[0]).toMatchObject({ key: 'a', start: day, end: day + 3, progress: 0.5, milestone: false })
    expect(tasks[1]).toMatchObject({ key: 'Build', start: day + 3, end: day + 8, deps: ['a'], group: 'Dev' })
    expect(tasks[2]).toMatchObject({ milestone: true, end: tasks[2].start, deps: ['Build'] })
    expect(taskExtent(tasks)).toEqual([day, day + 10])
  })

  it('picks a scale by span and aligns the domain', () => {
    expect(pickScale(20)).toBe('day')
    expect(pickScale(90)).toBe('week')
    expect(pickScale(400)).toBe('month')
    const start = parseDay('2026-10-07')! // Wednesday
    const [weekStart, weekEnd] = scaleDomain(start, start + 10, 'week')
    expect(dayParts(weekStart).weekday).toBe(1)
    expect(dayParts(weekEnd).weekday).toBe(1)
    const [monthStart, monthEnd] = scaleDomain(start, start + 40, 'month')
    expect(dayParts(monthStart)).toMatchObject({ month: 9, date: 1 })
    expect(dayParts(monthEnd)).toMatchObject({ month: 11, date: 1 })
  })

  it('builds header tiers and weekend stripes', () => {
    const start = parseDay('2026-10-29')!
    const tiers = buildTiers([start, start + 5], 'day', {
      month: (_, month) => `M${month + 1}`,
      monthYear: (year, month) => `${year}-${month + 1}`,
    })
    expect(tiers.top.map((cell) => cell.label)).toEqual(['2026-10', '2026-11'])
    expect(tiers.bottom.map((cell) => cell.label)).toEqual(['29', '30', '31', '1', '2'])
    expect(tiers.bottom.filter((cell) => cell.weekend).map((cell) => cell.label)).toEqual(['31', '1'])
    expect(weekendRuns([start, start + 5])).toEqual([[start + 2, start + 4]])
  })

  it('groups rows under headers and honours collapse', () => {
    const tasks = resolveTasks([
      { name: 'A', start: '2026-10-01', group: 'G1' },
      { name: 'B', start: '2026-10-02' },
      { name: 'C', start: '2026-10-05', group: 'G1', progress: 1 },
    ])
    const rows = buildRows(tasks, [])
    expect(rows.map((row) => (row.kind === 'group' ? `#${row.name}` : row.task.name))).toEqual(['#G1', 'A', 'C', 'B'])
    expect(rows[0]).toMatchObject({ count: 2, progress: 1 })
    expect(buildRows(tasks, ['G1']).map((row) => (row.kind === 'group' ? `#${row.name}` : row.task.name))).toEqual([
      '#G1',
      'B',
    ])
  })

  it('walks the dependency chain both ways', () => {
    const tasks = resolveTasks([
      { id: 'a', name: 'a', start: '2026-10-01' },
      { id: 'b', name: 'b', start: '2026-10-02', dependsOn: 'a' },
      { id: 'c', name: 'c', start: '2026-10-03', dependsOn: 'b' },
      { id: 'x', name: 'x', start: '2026-10-03' },
    ])
    expect([...dependencyChain(tasks, 'b')].sort()).toEqual(['a', 'b', 'c'])
  })

  it('routes connectors around overlapping tasks', () => {
    expect(connectorPath(10, 15, 60, 45, 30)).toBe('M10,15 H18 V45 H60')
    expect(connectorPath(50, 15, 50, 45, 30)).toBe('M50,15 H58 V30 H42 V45 H50')
  })
})

describe('quiz answers', () => {
  const options = ['Paris', 'Rome', 'Berlin']
  it('accepts indexes, option text and letters', () => {
    expect(resolveAnswer(1, options)).toBe(1)
    expect(resolveAnswer('berlin', options)).toBe(2)
    expect(resolveAnswer('B', options)).toBe(1)
    expect(resolveAnswer('(c)', options)).toBe(2)
    expect(resolveAnswer('0', options)).toBe(0)
    expect(resolveAnswer(3, options)).toBeNull()
    expect(resolveAnswer('Madrid', options)).toBeNull()
  })

  it('strips consistent letter prefixes only', () => {
    expect(stripLetterPrefixes(['A. Paris', 'B. Rome'])).toEqual(['Paris', 'Rome'])
    expect(stripLetterPrefixes(['A. Paris', 'Rome'])).toEqual(['A. Paris', 'Rome'])
    expect(resolveAnswer('Rome', ['A. Paris', 'B. Rome'])).toBe(1)
  })
})
