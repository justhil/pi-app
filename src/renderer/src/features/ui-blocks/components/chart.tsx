import { memo, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useBlockState } from '../block-state'
import { BlockFrame } from '../frame'
import { formatCompact, formatFull, seriesColor } from '../format'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { useElementWidth } from '../use-element-width'
import { arcPath, labelStep, linearScale, niceScale, seriesExtent, stackSeries } from './chart-math'

type SeriesType = 'line' | 'bar' | 'area'
type ChartSeries = { name: string; data: Array<number | null>; type?: SeriesType; axis?: 'left' | 'right' }
type ChartType = 'line' | 'bar' | 'area' | 'horizontal-bar' | 'pie' | 'donut' | 'scatter'
type ChartProps = {
  title?: string
  type: ChartType
  x?: string[]
  series: ChartSeries[]
  unit?: string
  rightUnit?: string
  stacked?: boolean
  height?: number
}

const schema = v.object<ChartProps>({
  title: v.optional(v.string()),
  type: v.enum(['line', 'bar', 'area', 'horizontal-bar', 'pie', 'donut', 'scatter'] as const),
  x: v.optional(v.array(v.string(), { max: 500 })),
  series: v.array(
    v.object<ChartSeries>({
      name: v.string(),
      data: v.array(v.nullableNumber(), { max: 500 }),
      type: v.optional(v.enum(['line', 'bar', 'area'] as const)),
      axis: v.optional(v.enum(['left', 'right'] as const)),
    }),
    { min: 1, max: 12 },
  ),
  unit: v.optional(v.string()),
  rightUnit: v.optional(v.string()),
  stacked: v.optional(v.boolean()),
  height: v.optional(v.number()),
})

const CHAR_W = 6.4

type IndexedSeries = ChartSeries & { index: number }

function seriesType(entry: ChartSeries, chartType: ChartType): SeriesType {
  return entry.type ?? (chartType === 'bar' || chartType === 'area' ? chartType : 'line')
}

function Legend({
  series,
  hidden,
  onToggle,
}: {
  series: ChartSeries[]
  hidden: string[]
  onToggle: (name: string) => void
}) {
  return (
    <div className="uib-legend">
      {series.map((entry, index) => {
        const off = hidden.includes(entry.name)
        return (
          <button
            key={entry.name}
            type="button"
            className="uib-legend-item"
            data-off={off || undefined}
            aria-pressed={!off}
            onClick={() => onToggle(entry.name)}
          >
            <span className="uib-legend-swatch" style={{ background: seriesColor(index) }} />
            {entry.name}
          </button>
        )
      })}
    </div>
  )
}

function Tooltip({ x, y, flip, children }: { x: number; y: number; flip: boolean; children: ReactNode }) {
  return (
    <div className="uib-tooltip" data-flip={flip || undefined} style={{ left: x, top: y }}>
      {children}
    </div>
  )
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="uib-tooltip-row">
      <span className="uib-tooltip-dot" style={{ background: color }} />
      <span className="uib-tooltip-label">{label}</span>
      <span className="uib-tooltip-value">{value}</span>
    </div>
  )
}

/* ─────────────── Cartesian: line / area / bar / scatter (+ mixed, stacked, dual axis) ─────────────── */

const CartesianChart = memo(function CartesianChart({
  props,
  width,
  visible,
  animate,
}: {
  props: ChartProps
  width: number
  visible: IndexedSeries[]
  animate: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const scatter = props.type === 'scatter'
  const chartType = props.type
  const typeOf = (entry: ChartSeries): SeriesType => seriesType(entry, chartType)
  const count = Math.max(props.x?.length ?? 0, ...visible.map((entry) => entry.data.length), 1)
  const labels = useMemo(
    () => Array.from({ length: count }, (_, index) => props.x?.[index] ?? String(index + 1)),
    [props.x, count],
  )
  const height = Math.max(160, Math.min(420, Math.round(props.height ?? 220)))

  const layout = useMemo(() => {
    const typeOf = (entry: ChartSeries): SeriesType => seriesType(entry, chartType)
    const groupScale = (group: IndexedSeries[]) => {
      if (group.length === 0) return null
      const includeZero = group.some((entry) => typeOf(entry) !== 'line')
      const stackable = !!props.stacked && group.some((entry) => typeOf(entry) !== 'line')
      const stacked = group.filter((entry) => stackable && typeOf(entry) !== 'line')
      const loose = group.filter((entry) => !stacked.includes(entry))
      const [a0, a1] = stacked.length ? seriesExtent(stacked.map((entry) => entry.data), true, true) : [Infinity, -Infinity]
      const [b0, b1] = loose.length ? seriesExtent(loose.map((entry) => entry.data), false, includeZero) : [Infinity, -Infinity]
      return niceScale(Math.min(a0, b0), Math.max(a1, b1), Math.max(3, Math.round(height / 48)))
    }
    const leftGroup = visible.filter((entry) => entry.axis !== 'right')
    const rightGroup = visible.filter((entry) => entry.axis === 'right')
    const leftScale = groupScale(leftGroup) ?? niceScale(0, 1)
    const rightScale = groupScale(rightGroup)
    const tickWidth = (ticks: number[]) => Math.max(...ticks.map((tick) => formatCompact(tick).length)) * CHAR_W + 12
    const margin = {
      top: 10,
      bottom: 24,
      left: Math.max(30, tickWidth(leftScale.ticks)),
      right: rightScale ? Math.max(30, tickWidth(rightScale.ticks)) : 14,
    }
    const plotW = Math.max(40, width - margin.left - margin.right)
    const plotH = height - margin.top - margin.bottom
    const yLeft = linearScale([leftScale.min, leftScale.max], [margin.top + plotH, margin.top])
    const yRight = rightScale ? linearScale([rightScale.min, rightScale.max], [margin.top + plotH, margin.top]) : yLeft

    let xOf: (index: number) => number
    let xTicks: Array<{ x: number; label: string }> = []
    let scatterX: number[] = []
    if (scatter) {
      scatterX = labels.map((label, index) => {
        const parsed = Number(label)
        return Number.isFinite(parsed) ? parsed : index
      })
      const xs = niceScale(Math.min(...scatterX), Math.max(...scatterX), Math.max(3, Math.round(plotW / 90)))
      const sx = linearScale([xs.min, xs.max], [margin.left, margin.left + plotW])
      xOf = (index) => sx(scatterX[index])
      xTicks = xs.ticks.map((tick) => ({ x: sx(tick), label: formatCompact(tick) }))
    } else {
      const hasBars = visible.some((entry) => typeOf(entry) === 'bar')
      const band = plotW / count
      const inset = 6
      xOf = hasBars || count === 1
        ? (index) => margin.left + band * (index + 0.5)
        : (index) => margin.left + inset + ((plotW - inset * 2) * index) / (count - 1)
      const step = labelStep(labels, plotW)
      xTicks = labels
        .map((label, index) => ({ x: xOf(index), label, index }))
        .filter((tick) => tick.index % step === 0)
    }
    return { margin, plotW, plotH, leftScale, rightScale, yLeft, yRight, xOf, xTicks, band: plotW / count }
  }, [visible, props.stacked, props.type, width, height, count, labels.join('\u0000')])

  const { margin, plotW, plotH, leftScale, rightScale, yLeft, yRight, xOf, xTicks, band } = layout
  const yFor = (entry: ChartSeries) => (entry.axis === 'right' ? yRight : yLeft)
  const barSeries = visible.filter((entry) => typeOf(entry) === 'bar')
  const areaSeries = visible.filter((entry) => typeOf(entry) === 'area')
  const lineSeries = visible.filter((entry) => typeOf(entry) === 'line')
  const barStacks = props.stacked ? stackSeries(barSeries.map((entry) => entry.data)) : null
  const areaStacks = props.stacked ? stackSeries(areaSeries.map((entry) => entry.data)) : null

  const linePath = (points: Array<[number, number] | null>) => {
    let open = false
    return points
      .map((point) => {
        if (!point) {
          open = false
          return ''
        }
        const command = `${open ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`
        open = true
        return command
      })
      .join(' ')
  }

  const groupWidth = band * 0.72
  const barWidth = props.stacked
    ? Math.min(groupWidth, 44)
    : Math.min(30, groupWidth / Math.max(1, barSeries.length))

  const tooltipSeries = scatter ? [] : visible
  const hoverX = hover != null ? xOf(hover) : 0
  const unitFor = (entry: ChartSeries) => (entry.axis === 'right' ? props.rightUnit ?? props.unit : props.unit)
  const zeroY = leftScale.min < 0 && leftScale.max > 0 ? yLeft(0) : null

  const [scatterHover, setScatterHover] = useState<{ series: IndexedSeries; index: number } | null>(null)

  return (
    <div className="uib-chart-canvas" style={{ height }}>
      <svg width={width} height={height} className="uib-chart-svg" role="img" aria-label={props.title}>
        {leftScale.ticks.map((tick) => (
          <g key={`l${tick}`}>
            <line className="uib-grid" x1={margin.left} x2={margin.left + plotW} y1={yLeft(tick)} y2={yLeft(tick)} />
            <text className="uib-axis" x={margin.left - 6} y={yLeft(tick)} dy="0.32em" textAnchor="end">
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        {rightScale?.ticks.map((tick) => (
          <text key={`r${tick}`} className="uib-axis" x={margin.left + plotW + 6} y={yRight(tick)} dy="0.32em">
            {formatCompact(tick)}
          </text>
        ))}
        {zeroY != null ? <line className="uib-zero" x1={margin.left} x2={margin.left + plotW} y1={zeroY} y2={zeroY} /> : null}
        {xTicks.map((tick, index) => (
          <text key={`x${index}`} className="uib-axis" x={tick.x} y={height - 6} textAnchor="middle">
            {tick.label}
          </text>
        ))}

        {areaSeries.map((entry, seriesIndex) => {
          const y = yFor(entry)
          const tops: Array<[number, number] | null> = []
          const bases: Array<[number, number] | null> = []
          entry.data.forEach((value, index) => {
            if (value == null) {
              tops.push(null)
              bases.push(null)
              return
            }
            const span = areaStacks?.[seriesIndex]?.[index] ?? [0, value]
            tops.push([xOf(index), y(span[1])])
            bases.push([xOf(index), y(span[0])])
          })
          const solid = tops.filter(Boolean) as Array<[number, number]>
          const floor = (bases.filter(Boolean) as Array<[number, number]>).reverse()
          if (solid.length < 2) return null
          const fill = `M${solid.map((point) => `${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' L')} L${floor
            .map((point) => `${point[0].toFixed(1)},${point[1].toFixed(1)}`)
            .join(' L')} Z`
          const color = seriesColor(entry.index)
          return (
            <g key={`a${entry.name}`}>
              <path className={animate ? 'uib-area uib-fade' : 'uib-area'} d={fill} style={{ fill: color }} />
              <path
                className={animate ? 'uib-line uib-draw' : 'uib-line'}
                d={linePath(tops)}
                pathLength={1}
                style={{ stroke: color }}
              />
            </g>
          )
        })}

        {barSeries.map((entry, seriesIndex) => {
          const y = yFor(entry)
          const color = seriesColor(entry.index)
          return (
            <g key={`b${entry.name}`}>
              {entry.data.map((value, index) => {
                if (value == null) return null
                const span = barStacks?.[seriesIndex]?.[index] ?? [0, value]
                const top = Math.min(y(span[0]), y(span[1]))
                const barHeight = Math.max(1, Math.abs(y(span[1]) - y(span[0])))
                const x = props.stacked
                  ? xOf(index) - barWidth / 2
                  : xOf(index) - (barWidth * barSeries.length) / 2 + seriesIndex * barWidth
                return (
                  <rect
                    key={index}
                    className={animate ? 'uib-bar uib-grow-y' : 'uib-bar'}
                    data-neg={span[1] < span[0] || undefined}
                    data-dim={hover != null && hover !== index ? 'true' : undefined}
                    x={x + 0.5}
                    y={top}
                    width={Math.max(1, barWidth - 1)}
                    height={barHeight}
                    rx={Math.min(3, barWidth / 4)}
                    style={{ fill: color, '--d': `${Math.min(index * 18, 360)}ms` } as CSSProperties}
                  />
                )
              })}
            </g>
          )
        })}

        {lineSeries.map((entry) => {
          const y = yFor(entry)
          const color = seriesColor(entry.index)
          if (scatter) {
            return (
              <g key={`s${entry.name}`}>
                {entry.data.map((value, index) =>
                  value == null ? null : (
                    <circle
                      key={index}
                      className={animate ? 'uib-point uib-pop' : 'uib-point'}
                      cx={xOf(index)}
                      cy={y(value)}
                      r={scatterHover?.series.name === entry.name && scatterHover.index === index ? 5 : 3.5}
                      style={{ fill: color, '--d': `${Math.min(index * 12, 360)}ms` } as CSSProperties}
                      onPointerEnter={() => setScatterHover({ series: entry, index })}
                      onPointerLeave={() => setScatterHover(null)}
                    />
                  ),
                )}
              </g>
            )
          }
          const points = entry.data.map((value, index) => (value == null ? null : ([xOf(index), y(value)] as [number, number])))
          return (
            <g key={`ln${entry.name}`}>
              <path
                className={animate ? 'uib-line uib-draw' : 'uib-line'}
                d={linePath(points)}
                pathLength={1}
                style={{ stroke: color }}
              />
              {count <= 24
                ? points.map((point, index) =>
                    point ? <circle key={index} className="uib-dot" cx={point[0]} cy={point[1]} r={2.4} style={{ stroke: color }} /> : null,
                  )
                : null}
            </g>
          )
        })}

        {hover != null && !scatter ? (
          <g className="uib-hover" pointerEvents="none">
            <line className="uib-crosshair" x1={hoverX} x2={hoverX} y1={margin.top} y2={margin.top + plotH} />
            {[...lineSeries, ...areaSeries].map((entry, seriesIndex) => {
              const value = entry.data[hover]
              if (value == null) return null
              const stackTop = typeOf(entry) === 'area' ? areaStacks?.[areaSeries.indexOf(entry)]?.[hover]?.[1] : undefined
              const y = yFor(entry)(stackTop ?? value)
              return <circle key={seriesIndex} className="uib-hover-dot" cx={hoverX} cy={y} r={4} style={{ fill: seriesColor(entry.index) }} />
            })}
          </g>
        ) : null}

        {!scatter ? (
          <rect
            className="uib-hit"
            x={margin.left}
            y={margin.top}
            width={plotW}
            height={plotH}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const offset = event.clientX - box.left
              let index: number
              if (visible.some((entry) => typeOf(entry) === 'bar') || count === 1) index = Math.floor(offset / band)
              else index = Math.round(((offset - 6) / Math.max(1, plotW - 12)) * (count - 1))
              index = Math.max(0, Math.min(count - 1, index))
              setHover((previous) => (previous === index ? previous : index))
            }}
            onPointerLeave={() => setHover(null)}
          />
        ) : null}
      </svg>
      {hover != null && !scatter ? (
        <Tooltip x={hoverX + (hoverX > width - 190 ? -12 : 12)} y={margin.top + 4} flip={hoverX > width - 190}>
          <div className="uib-tooltip-head">{labels[hover]}</div>
          {tooltipSeries.map((entry) => {
            const value = entry.data[hover]
            return value == null ? null : (
              <TooltipRow key={entry.name} color={seriesColor(entry.index)} label={entry.name} value={formatFull(value, unitFor(entry))} />
            )
          })}
        </Tooltip>
      ) : null}
      {scatterHover ? (
        (() => {
          const value = scatterHover.series.data[scatterHover.index]
          const px = xOf(scatterHover.index)
          const flip = px > width - 190
          return value == null ? null : (
            <Tooltip x={px + (flip ? -12 : 12)} y={Math.max(4, yFor(scatterHover.series)(value) - 20)} flip={flip}>
              <TooltipRow
                color={seriesColor(scatterHover.series.index)}
                label={`${scatterHover.series.name} · x=${labels[scatterHover.index]}`}
                value={formatFull(value, props.unit)}
              />
            </Tooltip>
          )
        })()
      ) : null}
    </div>
  )
})

/* ─────────────── Horizontal bars ─────────────── */

const HorizontalBarChart = memo(function HorizontalBarChart({
  props,
  width,
  visible,
  animate,
}: {
  props: ChartProps
  width: number
  visible: IndexedSeries[]
  animate: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const count = Math.max(props.x?.length ?? 0, ...visible.map((entry) => entry.data.length), 1)
  const labels = Array.from({ length: count }, (_, index) => props.x?.[index] ?? String(index + 1))
  const rowH = visible.length > 1 && !props.stacked ? Math.max(26, visible.length * 10 + 10) : 26
  const labelWidth = Math.max(56, Math.min(170, Math.max(...labels.map((label) => label.length * CHAR_W)) + 14))
  const margin = { top: 4, bottom: 22, left: labelWidth, right: visible.length === 1 ? 52 : 16 }
  const height = margin.top + count * rowH + margin.bottom
  const plotW = Math.max(40, width - margin.left - margin.right)
  const stacks = props.stacked ? stackSeries(visible.map((entry) => entry.data)) : null
  const [e0, e1] = seriesExtent(visible.map((entry) => entry.data), !!props.stacked, true)
  const scale = niceScale(e0, e1, Math.max(3, Math.round(plotW / 90)))
  const x = linearScale([scale.min, scale.max], [margin.left, margin.left + plotW])
  const thickness = props.stacked ? Math.min(18, rowH - 8) : Math.min(16, (rowH - 8) / Math.max(1, visible.length))
  const maxChars = Math.floor((labelWidth - 12) / CHAR_W)

  return (
    <div className="uib-chart-canvas" style={{ height }}>
      <svg width={width} height={height} className="uib-chart-svg" role="img" aria-label={props.title}>
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line className="uib-grid" x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} />
            <text className="uib-axis" x={x(tick)} y={height - 6} textAnchor="middle">
              {formatCompact(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, row) => {
          const cy = margin.top + row * rowH + rowH / 2
          return (
            <g key={row} data-dim={hover != null && hover !== row ? 'true' : undefined} className="uib-hrow">
              <text className="uib-axis uib-axis-strong" x={margin.left - 8} y={cy} dy="0.32em" textAnchor="end">
                {label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label}
              </text>
              {visible.map((entry, seriesIndex) => {
                const value = entry.data[row]
                if (value == null) return null
                const span = stacks?.[seriesIndex]?.[row] ?? [0, value]
                const x0 = Math.min(x(span[0]), x(span[1]))
                const w = Math.max(1, Math.abs(x(span[1]) - x(span[0])))
                const y = props.stacked ? cy - thickness / 2 : cy - (thickness * visible.length) / 2 + seriesIndex * thickness
                return (
                  <g key={entry.name}>
                    <rect
                      className={animate ? 'uib-bar uib-grow-x' : 'uib-bar'}
                      data-neg={span[1] < span[0] || undefined}
                      x={x0}
                      y={y + 0.5}
                      width={w}
                      height={Math.max(1, thickness - 1)}
                      rx={Math.min(3, thickness / 4)}
                      style={{ fill: seriesColor(entry.index), '--d': `${Math.min(row * 22, 380)}ms` } as CSSProperties}
                    />
                    {visible.length === 1 ? (
                      <text className="uib-axis uib-bar-value" x={x0 + w + 6} y={cy} dy="0.32em">
                        {formatCompact(value)}
                      </text>
                    ) : null}
                  </g>
                )
              })}
              <rect
                className="uib-hit"
                x={0}
                y={cy - rowH / 2}
                width={width}
                height={rowH}
                onPointerEnter={() => setHover(row)}
                onPointerLeave={() => setHover((previous) => (previous === row ? null : previous))}
              />
            </g>
          )
        })}
      </svg>
      {hover != null && visible.length > 1 ? (
        <Tooltip x={margin.left + 8} y={margin.top + hover * rowH + rowH} flip={false}>
          <div className="uib-tooltip-head">{labels[hover]}</div>
          {visible.map((entry) =>
            entry.data[hover] == null ? null : (
              <TooltipRow key={entry.name} color={seriesColor(entry.index)} label={entry.name} value={formatFull(entry.data[hover]!, props.unit)} />
            ),
          )}
        </Tooltip>
      ) : null}
    </div>
  )
})

/* ─────────────── Pie / donut ─────────────── */

const PieChart = memo(function PieChart({
  props,
  width,
  animate,
  maskId,
}: {
  props: ChartProps
  width: number
  animate: boolean
  maskId: string
}) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const slices = useMemo(() => {
    const perSeries = props.series.length > 1 && props.series.every((entry) => entry.data.length <= 1)
    const raw = perSeries
      ? props.series.map((entry) => ({ label: entry.name, value: entry.data[0] ?? 0 }))
      : (props.series[0]?.data ?? []).map((value, index) => ({ label: props.x?.[index] ?? String(index + 1), value: value ?? 0 }))
    return raw.map((slice, index) => ({ ...slice, color: seriesColor(index) })).filter((slice) => slice.value > 0)
  }, [props.series, props.x])
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1
  const size = Math.max(140, Math.min(220, Math.round(width * 0.42)))
  const outer = size / 2 - 6
  const inner = props.type === 'donut' ? outer * 0.62 : 0
  const center = size / 2
  let cursor = 0
  const arcs = slices.map((slice, index) => {
    const start = cursor
    const end = cursor + (slice.value / total) * Math.PI * 2
    cursor = end
    const mid = (start + end) / 2
    return { ...slice, index, d: arcPath(center, center, outer, inner, start, end), dx: Math.sin(mid) * 5, dy: -Math.cos(mid) * 5 }
  })

  return (
    <div className="uib-pie">
      <svg width={size} height={size} className="uib-chart-svg" role="img" aria-label={props.title}>
        {animate ? (
          <defs>
            <mask id={maskId}>
              <circle
                className="uib-sweep"
                cx={center}
                cy={center}
                r={outer / 2}
                pathLength={1}
                transform={`rotate(-90 ${center} ${center})`}
                style={{ strokeWidth: outer + 2 }}
              />
            </mask>
          </defs>
        ) : null}
        <g mask={animate ? `url(#${maskId})` : undefined}>
          {arcs.map((arc) => (
            <path
              key={arc.label}
              className="uib-slice"
              d={arc.d}
              data-dim={hover != null && hover !== arc.index ? 'true' : undefined}
              style={{
                fill: arc.color,
                transform: hover === arc.index ? `translate(${arc.dx}px, ${arc.dy}px)` : undefined,
              }}
              onPointerEnter={() => setHover(arc.index)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </g>
        {inner > 0 ? (
          <g pointerEvents="none">
            <text className="uib-pie-total" x={center} y={center - 4} textAnchor="middle">
              {formatCompact(hover != null ? arcs[hover]?.value ?? total : total)}
            </text>
            <text className="uib-axis" x={center} y={center + 14} textAnchor="middle">
              {hover != null ? arcs[hover]?.label : t('timeline:uiBlock.total')}
            </text>
          </g>
        ) : null}
      </svg>
      <ul className="uib-pie-legend">
        {arcs.map((arc) => (
          <li
            key={arc.label}
            data-dim={hover != null && hover !== arc.index ? 'true' : undefined}
            onPointerEnter={() => setHover(arc.index)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="uib-tooltip-dot" style={{ background: arc.color }} />
            <span className="uib-pie-label">{arc.label}</span>
            <span className="uib-pie-value">{formatFull(arc.value, props.unit)}</span>
            <span className="uib-pie-pct">{((arc.value / total) * 100).toFixed(arc.value / total < 0.1 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
})

/* ─────────────── Block ─────────────── */

function Chart({ props, blockKey, animate }: UIBlockComponentProps<ChartProps>) {
  const [containerRef, width] = useElementWidth()
  const maskId = `uib-mask-${useId().replace(/[^\w-]/g, '')}`
  const [hidden, setHidden] = useBlockState<string[]>(blockKey, 'hidden', [])
  const pie = props.type === 'pie' || props.type === 'donut'
  const indexed = useMemo(() => props.series.map((entry, index) => ({ ...entry, index })), [props.series])
  const visible = useMemo(() => {
    const shown = indexed.filter((entry) => !hidden.includes(entry.name))
    return shown.length ? shown : indexed
  }, [indexed, hidden])
  const toggle = (name: string) =>
    setHidden((previous) => (previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name]))

  return (
    <BlockFrame title={props.title} animate={animate}>
      {!pie && props.series.length > 1 ? <Legend series={props.series} hidden={hidden} onToggle={toggle} /> : null}
      <div ref={containerRef} className="uib-chart">
        {pie ? (
          <PieChart props={props} width={width} animate={animate} maskId={maskId} />
        ) : props.type === 'horizontal-bar' ? (
          <HorizontalBarChart props={props} width={width} visible={visible} animate={animate} />
        ) : (
          <CartesianChart props={props} width={width} visible={visible} animate={animate} />
        )}
      </div>
    </BlockFrame>
  )
}

export const chartDefinition: UIBlockDefinition<ChartProps> = {
  name: 'chart',
  schema,
  Component: Chart,
  skeleton: 'chart',
}
