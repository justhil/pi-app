import { memo, useState, type CSSProperties } from 'react'
import { BlockFrame } from '../frame'
import { resolveTrend, type Trend } from '../format'
import { v } from '../schema'
import type { UIBlockComponentProps, UIBlockDefinition } from '../types'
import { Sparkline } from './sparkline'

type StatTone = 'positive' | 'negative' | 'neutral'

type StatItem = {
  label: string
  value: string
  unit?: string
  delta?: string
  trend?: Trend
  tone?: StatTone
  note?: string
  history?: Array<number | null>
}
type StatGridProps = { title?: string; periods?: string[]; items: StatItem[] }

const schema = v.object<StatGridProps>({
  title: v.optional(v.string()),
  periods: v.optional(v.array(v.string())),
  items: v.array(
    v.object<StatItem>({
      label: v.string(),
      value: v.string(),
      unit: v.optional(v.string()),
      delta: v.optional(v.string()),
      trend: v.optional(v.enum(['up', 'down', 'flat'] as const)),
      tone: v.optional(v.enum(['positive', 'negative', 'neutral'] as const)),
      note: v.optional(v.string()),
      history: v.optional(v.array(v.nullableNumber())),
    }),
    { min: 1, max: 24 },
  ),
})

const TREND_GLYPH: Record<Trend, string> = { up: '▲', down: '▼', flat: '■' }

function toneToTrend(tone: StatTone | undefined, fallback: Trend | undefined): Trend | undefined {
  if (tone === 'positive') return 'up'
  if (tone === 'negative') return 'down'
  if (tone === 'neutral') return 'flat'
  return fallback
}

const StatCard = memo(function StatCard({
  item,
  periods,
  index,
  animate,
}: {
  item: StatItem
  periods?: string[]
  index: number
  animate: boolean
}) {
  // Direction = arrow sign; colour = semantic `tone` when provided, else explicit `trend` / delta sign.
  const inferred = resolveTrend(item.trend, item.delta)
  const colorTrend = toneToTrend(item.tone, inferred)
  const direction = item.trend ?? resolveTrend(undefined, item.delta) ?? 'flat'
  const [readout, setReadout] = useState<string | null>(null)
  return (
    <div
      className={animate ? 'uib-card uib-stat uib-stagger' : 'uib-card uib-stat'}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="uib-stat-label">{item.label}</div>
      <div className="uib-stat-value">
        <span>{item.value}</span>
        {item.unit ? <span className="uib-stat-unit">{item.unit}</span> : null}
      </div>
      <div className="uib-stat-meta">
        {item.delta ? (
          <span className="uib-delta" data-trend={colorTrend ?? 'flat'}>
            <span aria-hidden>{TREND_GLYPH[direction]}</span>
            {item.delta.replace(/^[▲▼↑↓]\s*/, '')}
          </span>
        ) : null}
        <span className="uib-stat-note">{readout ?? item.note}</span>
      </div>
      {item.history && item.history.length > 1 ? (
        <Sparkline values={item.history} labels={periods} tone={colorTrend} animate={animate} onHover={setReadout} />
      ) : null}
    </div>
  )
})

function StatGrid({ props, animate }: UIBlockComponentProps<StatGridProps>) {
  return (
    <BlockFrame title={props.title} animate={animate}>
      <div className="uib-stat-grid">
        {props.items.map((item, index) => (
          <StatCard key={`${item.label}-${index}`} item={item} periods={props.periods} index={index} animate={animate} />
        ))}
      </div>
    </BlockFrame>
  )
}

export const statGridDefinition: UIBlockDefinition<StatGridProps> = {
  name: 'stat-grid',
  schema,
  Component: StatGrid,
  skeleton: 'cards',
}
