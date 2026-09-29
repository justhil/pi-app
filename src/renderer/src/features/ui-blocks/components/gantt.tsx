import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { useBlockState } from '../block-state'
import { BlockFrame, Segmented } from '../frame'
import { seriesColor } from '../format'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { useElementWidth } from '../use-element-width'
import {
  buildRows,
  buildTiers,
  connectorPath,
  DAY_MS,
  dependencyChain,
  localToday,
  MIN_PX_PER_DAY,
  parseDay,
  pickScale,
  resolveTasks,
  scaleDomain,
  taskExtent,
  weekendRuns,
  type GanttRow,
  type GanttScale,
  type GanttTaskInput,
  type ResolvedTask,
} from './gantt-math'

type GanttProps = { title?: string; today?: string; scale?: GanttScale; tasks: GanttTaskInput[] }

const date = v.custom<string>((value) => (parseDay(value) != null ? String(value) : undefined), 'expected date YYYY-MM-DD')

const schema = v.object<GanttProps>({
  title: v.optional(v.string()),
  today: v.optional(v.string()),
  scale: v.optional(v.enum(['day', 'week', 'month'] as const)),
  tasks: v.array(
    v.object<GanttTaskInput>({
      id: v.optional(v.string()),
      name: v.string(),
      start: date,
      end: v.optional(date),
      duration: v.optional(v.number()),
      progress: v.optional(v.number()),
      group: v.optional(v.string()),
      dependsOn: v.optional(v.union<string | string[]>(v.string(), v.array(v.string()))),
      milestone: v.optional(v.boolean()),
    }),
    { min: 1, max: 200 },
  ),
})

const ROW_H = 30
const DIAMOND = 12

/** Rough rendered width in "latin character" units (CJK glyphs count ~2). */
function textUnits(text: string): number {
  let units = 0
  for (const char of text) units += char.charCodeAt(0) > 0x2e80 ? 1.9 : 1
  return units
}

type RowState = 'focus' | 'chain' | 'dim' | undefined

const TaskRow = memo(function TaskRow({
  task,
  grouped,
  index,
  x,
  width,
  color,
  state,
  animate,
  onHover,
  onFocus,
  onClear,
}: {
  task: ResolvedTask
  grouped: boolean
  index: number
  x: number
  width: number
  color: string
  state: RowState
  animate: boolean
  onHover: (key: string | null, anchor?: HTMLElement) => void
  onFocus: (key: string) => void
  onClear: () => void
}) {
  const style = {
    left: task.milestone ? x - DIAMOND / 2 : x,
    width: task.milestone ? DIAMOND : Math.max(3, width),
    '--bar': color,
    '--d': `${Math.min(index * 28, 420)}ms`,
  } as CSSProperties
  // Percent sits inside wide bars (outside, it collides with outgoing dependency arrows).
  const showProgress = task.progress != null && !task.milestone
  const pctInside = showProgress && width >= 44
  return (
    <div className="uib-gantt-row" data-state={state}>
      <button type="button" className="uib-gantt-label" data-grouped={grouped || undefined} onClick={() => onFocus(task.key)} title={task.name}>
        {task.milestone ? <span className="uib-gantt-label-diamond" style={{ '--bar': color } as CSSProperties} aria-hidden /> : null}
        <span className="uib-gantt-label-text">{task.name}</span>
      </button>
      <div
        className="uib-gantt-track"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClear()
        }}
      >
        <button
          type="button"
          className={cn('uib-gantt-bar', animate && (task.milestone ? 'uib-pop' : 'uib-gantt-grow'))}
          data-milestone={task.milestone || undefined}
          style={style}
          aria-label={task.name}
          onPointerEnter={(event) => onHover(task.key, event.currentTarget)}
          onPointerLeave={() => onHover(null)}
          onFocus={(event) => onHover(task.key, event.currentTarget)}
          onBlur={() => onHover(null)}
          onClick={() => onFocus(task.key)}
        >
          {showProgress ? <span className="uib-gantt-progress" style={{ transform: `scaleX(${task.progress})` }} /> : null}
          {pctInside ? (
            <span className="uib-gantt-pct" data-on-fill={task.progress! >= 0.8 || undefined}>
              {Math.round(task.progress! * 100)}%
            </span>
          ) : null}
        </button>
      </div>
    </div>
  )
})

const GroupRow = memo(function GroupRow({
  row,
  index,
  x,
  width,
  color,
  dim,
  animate,
  onToggle,
  onClear,
}: {
  row: Extract<GanttRow, { kind: 'group' }>
  index: number
  x: number
  width: number
  color: string
  dim: boolean
  animate: boolean
  onToggle: (name: string) => void
  onClear: () => void
}) {
  return (
    <div className="uib-gantt-row" data-group data-state={dim ? 'dim' : undefined}>
      <button type="button" className="uib-gantt-label uib-gantt-group-label" aria-expanded={!row.collapsed} onClick={() => onToggle(row.name)}>
        <ChevronDown className="uib-gantt-chevron" data-collapsed={row.collapsed || undefined} aria-hidden />
        <span className="uib-gantt-label-text">{row.name}</span>
        <span className="uib-gantt-count">{row.count}</span>
      </button>
      <div
        className="uib-gantt-track"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClear()
        }}
      >
        <span
          className={cn('uib-gantt-summary', animate && 'uib-gantt-grow')}
          style={{ left: x, width: Math.max(3, width), '--bar': color, '--d': `${Math.min(index * 28, 420)}ms` } as CSSProperties}
        >
          {row.progress != null ? <span className="uib-gantt-progress" style={{ transform: `scaleX(${row.progress})` }} /> : null}
        </span>
      </div>
    </div>
  )
})

function Gantt({ props, blockKey, animate }: UIBlockComponentProps<GanttProps>) {
  const { t, i18n } = useTranslation()
  const uid = useId().replace(/[^\w-]/g, '')
  const [wrapRef, containerWidth] = useElementWidth(640)
  const tasks = useMemo(() => resolveTasks(props.tasks), [props.tasks])
  const byKey = useMemo(() => new Map(tasks.map((task) => [task.key, task])), [tasks])
  const extent = useMemo(() => taskExtent(tasks), [tasks])
  const [scaleChoice, setScaleChoice] = useBlockState<GanttScale | null>(blockKey, 'scale', null)
  const [collapsed, setCollapsed] = useBlockState<string[]>(blockKey, 'collapsed', [])
  const [focus, setFocus] = useBlockState<string | null>(blockKey, 'focus', null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TipAnchor | null>(null)
  // Tooltip lives outside the scroll box (never clipped); anchor it from the bar's rect on hover.
  const showTip = useCallback((key: string | null, anchor?: HTMLElement) => {
    const shell = shellRef.current
    if (!key || !anchor || !shell) {
      setTip(null)
      return
    }
    const box = anchor.getBoundingClientRect()
    const frame = shell.getBoundingClientRect()
    setTip({
      key,
      left: box.left - frame.left,
      right: box.right - frame.left,
      top: box.top - frame.top,
      bottom: box.bottom - frame.top,
      width: frame.width,
      height: frame.height,
    })
  }, [])
  const scale = scaleChoice ?? props.scale ?? pickScale(extent[1] - extent[0])

  const domain = useMemo(() => scaleDomain(extent[0], extent[1], scale), [extent, scale])
  const origin = domain[0]
  const spanDays = domain[1] - domain[0]
  const labelWidth = useMemo(() => {
    const longest = Math.max(
      ...tasks.map((task) => textUnits(task.name) + (task.group ? 2 : 0) + (task.milestone ? 2 : 0)),
      ...tasks.map((task) => (task.group ? textUnits(task.group) + 5 : 0)),
    )
    return Math.round(Math.min(Math.max(96, longest * 6.8 + 30), Math.max(120, containerWidth * 0.34), 240))
  }, [tasks, containerWidth])
  const trackWidth = Math.max(containerWidth - labelWidth, Math.ceil(spanDays * MIN_PX_PER_DAY[scale]))
  const pxPerDay = trackWidth / spanDays
  const px = (day: number) => (day - origin) * pxPerDay

  const locale = i18n.language
  const formats = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
      monthYear: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    }),
    [locale],
  )
  const tiers = useMemo(
    () =>
      buildTiers(domain, scale, {
        month: (year, month) => formats.month.format(Date.UTC(year, month, 1)),
        monthYear: (year, month) => formats.monthYear.format(Date.UTC(year, month, 1)),
      }),
    [domain, scale, formats],
  )
  const weekends = useMemo(() => (scale === 'day' ? weekendRuns(domain) : []), [domain, scale])
  const rows = useMemo(() => buildRows(tasks, collapsed), [tasks, collapsed])
  const rowOf = useMemo(() => {
    const map = new Map<string, number>()
    rows.forEach((row, index) => {
      if (row.kind === 'task') map.set(row.task.key, index)
    })
    return map
  }, [rows])
  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) if (task.group && !map.has(task.group)) map.set(task.group, seriesColor(map.size))
    return (group: string | null) => (group ? map.get(group)! : seriesColor(0))
  }, [tasks])
  const chain = useMemo(() => (focus && byKey.has(focus) ? dependencyChain(tasks, focus) : null), [tasks, byKey, focus])
  const edges = useMemo(() => {
    const list: Array<{ id: string; from: string; to: string; d: string }> = []
    for (const task of tasks) {
      const to = rowOf.get(task.key)
      if (to == null) continue
      for (const dep of task.deps) {
        const from = rowOf.get(dep)
        const pred = byKey.get(dep)
        if (from == null || !pred) continue
        const x1 = pred.milestone ? (pred.start - origin) * pxPerDay + DIAMOND / 2 : (pred.end - origin) * pxPerDay
        const x2 = task.milestone ? (task.start - origin) * pxPerDay - DIAMOND / 2 : (task.start - origin) * pxPerDay
        list.push({
          id: `${dep}->${task.key}`,
          from: dep,
          to: task.key,
          d: connectorPath(x1, from * ROW_H + ROW_H / 2, x2, to * ROW_H + ROW_H / 2, ROW_H),
        })
      }
    }
    return list
  }, [tasks, byKey, rowOf, origin, pxPerDay])

  const today = parseDay(props.today) ?? localToday()
  const todayX = today >= domain[0] && today < domain[1] ? (today + 0.5 - origin) * pxPerDay : null

  const toggleFocus = useCallback((key: string) => setFocus((previous) => (previous === key ? null : key)), [setFocus])
  const clearFocus = useCallback(() => setFocus(null), [setFocus])
  const toggleGroup = useCallback(
    (name: string) => setCollapsed((previous) => (previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name])),
    [setCollapsed],
  )

  // When the timeline overflows, open it around today once instead of at the far left.
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    const element = wrapRef.current
    if (scrolled.current || !element || todayX == null || element.scrollWidth <= element.clientWidth + 1) return
    scrolled.current = true
    element.scrollLeft = Math.max(0, todayX - (element.clientWidth - labelWidth) / 3)
  }, [wrapRef, todayX, labelWidth])

  const hovered = tip ? byKey.get(tip.key) : undefined
  const scaleLabel: Record<GanttScale, string> = {
    day: t('timeline:uiBlock.scaleDay'),
    week: t('timeline:uiBlock.scaleWeek'),
    month: t('timeline:uiBlock.scaleMonth'),
  }

  return (
    <BlockFrame
      title={props.title}
      animate={animate}
      actions={
        <Segmented
          label={t('timeline:uiBlock.scale')}
          value={scale}
          onChange={setScaleChoice}
          options={(['day', 'week', 'month'] as const).map((value) => ({ value, label: scaleLabel[value] }))}
        />
      }
    >
      <div ref={shellRef} className="uib-gantt-shell">
      <div ref={wrapRef} className="uib-gantt-scroll">
        <div
          className="uib-gantt"
          data-focused={chain ? 'true' : undefined}
          style={{ width: labelWidth + trackWidth, '--gl': `${labelWidth}px` } as CSSProperties}
        >
          <div className="uib-gantt-head">
            <div className="uib-gantt-corner" />
            <div className="uib-gantt-tiers" style={{ width: trackWidth }}>
              {(['top', 'bottom'] as const).map((tier) => (
                <div key={tier} className="uib-gantt-tier" data-tier={tier}>
                  {tiers[tier].map((cell) => {
                    const cellWidth = (cell.end - cell.start) * pxPerDay
                    // A sliver of a month at the range edge gets no label rather than a clipped one.
                    const fits = tier === 'bottom' || cellWidth >= textUnits(cell.label) * 6.6 + 14
                    return (
                      <span
                        key={cell.start}
                        className="uib-gantt-cell"
                        data-weekend={cell.weekend || undefined}
                        data-today={(tier === 'bottom' && scale === 'day' && cell.start === today) || undefined}
                        style={{ left: px(cell.start), width: cellWidth }}
                      >
                        {tier === 'top' ? fits ? <span className="uib-gantt-cell-label">{cell.label}</span> : null : cell.label}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="uib-gantt-body" style={{ height: rows.length * ROW_H }}>
            <div className="uib-gantt-canvas" style={{ left: labelWidth, width: trackWidth }} aria-hidden>
              {weekends.map(([start, end]) => (
                <span key={start} className="uib-gantt-weekend" style={{ left: px(start), width: (end - start) * pxPerDay }} />
              ))}
              {tiers.bottom.slice(1).map((cell) => (
                <span key={cell.start} className="uib-gantt-gridline" style={{ left: px(cell.start) }} />
              ))}
              {edges.length ? (
                <svg
                  className={cn('uib-gantt-links', animate && 'uib-fade')}
                  width={trackWidth}
                  height={rows.length * ROW_H}
                  style={{ '--d': '380ms' } as CSSProperties}
                >
                  <defs>
                    {(['idle', 'active', 'dim'] as const).map((kind) => (
                      <marker
                        key={kind}
                        id={`${uid}-${kind}`}
                        className="uib-gantt-arrow"
                        data-kind={kind}
                        viewBox="0 0 6 6"
                        refX="5.5"
                        refY="3"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M0,0.4 L5.6,3 L0,5.6 Z" />
                      </marker>
                    ))}
                  </defs>
                  {edges.map((edge) => {
                    const active = !!chain && chain.has(edge.from) && chain.has(edge.to)
                    const kind = active ? 'active' : chain ? 'dim' : 'idle'
                    return (
                      <path
                        key={edge.id}
                        className="uib-gantt-link"
                        d={edge.d}
                        data-kind={kind}
                        markerEnd={`url(#${uid}-${kind})`}
                      />
                    )
                  })}
                </svg>
              ) : null}
              {todayX != null ? (
                <span className="uib-gantt-today" style={{ left: todayX }}>
                  <span className="uib-gantt-today-pill">{t('timeline:uiBlock.today')}</span>
                </span>
              ) : null}
            </div>
            {rows.map((row, index) =>
              row.kind === 'group' ? (
                <GroupRow
                  key={`g:${row.name}`}
                  row={row}
                  index={index}
                  x={px(row.start)}
                  width={(row.end - row.start) * pxPerDay}
                  color={colorOf(row.name)}
                  dim={!!chain && !tasks.some((task) => task.group === row.name && chain.has(task.key))}
                  animate={animate}
                  onToggle={toggleGroup}
                  onClear={clearFocus}
                />
              ) : (
                <TaskRow
                  key={row.task.key}
                  task={row.task}
                  grouped={row.grouped}
                  index={index}
                  x={px(row.task.start)}
                  width={(row.task.end - row.task.start) * pxPerDay}
                  color={colorOf(row.task.group)}
                  state={!chain ? undefined : row.task.key === focus ? 'focus' : chain.has(row.task.key) ? 'chain' : 'dim'}
                  animate={animate}
                  onHover={showTip}
                  onFocus={toggleFocus}
                  onClear={clearFocus}
                />
              ),
            )}
          </div>
        </div>
      </div>
      {hovered && tip ? (
        <GanttTooltip
          task={hovered}
          deps={hovered.deps.map((dep) => byKey.get(dep)?.name ?? dep)}
          anchor={tip}
          formatDay={(day) => formats.day.format(day * DAY_MS)}
        />
      ) : null}
      </div>
    </BlockFrame>
  )
}

type TipAnchor = { key: string; left: number; right: number; top: number; bottom: number; width: number; height: number }

function GanttTooltip({
  task,
  deps,
  anchor,
  formatDay,
}: {
  task: ResolvedTask
  deps: string[]
  anchor: TipAnchor
  formatDay: (day: number) => string
}) {
  const { t } = useTranslation()
  const above = anchor.bottom + 96 > anchor.height && anchor.top > 96
  const flip = anchor.left > anchor.width - 230
  const days = task.end - task.start
  return (
    <div
      className="uib-tooltip uib-gantt-tip"
      data-flip={flip || undefined}
      data-above={above || undefined}
      style={{ left: Math.max(0, flip ? anchor.right : anchor.left), top: above ? anchor.top - 6 : anchor.bottom + 6 }}
    >
      <div className="uib-tooltip-head">{task.name}</div>
      <div className="uib-tooltip-row">
        <span className="uib-tooltip-label">
          {task.milestone ? formatDay(task.start) : `${formatDay(task.start)} – ${formatDay(task.end - 1)}`}
        </span>
        <span className="uib-tooltip-value">
          {task.milestone ? t('timeline:uiBlock.milestone') : t('timeline:uiBlock.days', { count: days })}
        </span>
      </div>
      {task.progress != null && !task.milestone ? (
        <div className="uib-tooltip-row">
          <span className="uib-tooltip-label">{t('timeline:uiBlock.progress')}</span>
          <span className="uib-tooltip-value">{Math.round(task.progress * 100)}%</span>
        </div>
      ) : null}
      {deps.length ? (
        <div className="uib-tooltip-row">
          <span className="uib-tooltip-label">{t('timeline:uiBlock.dependsOn')}</span>
          <span className="uib-tooltip-value">{deps.join(', ')}</span>
        </div>
      ) : null}
    </div>
  )
}

export const ganttDefinition: UIBlockDefinition<GanttProps> = {
  name: 'gantt',
  schema,
  Component: Gantt,
  skeleton: 'rows',
}
