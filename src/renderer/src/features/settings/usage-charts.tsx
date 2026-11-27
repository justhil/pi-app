import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageBucket, UsageStatsBucket, UsageSummary } from '@shared/usage-summary'
import { cn } from '@renderer/lib/utils'

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function formatCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

export function formatExactCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0'
  if (n < 0.0001) return '<$0.0001'
  if (n < 1) return `$${n.toFixed(4).replace(/(\.\d{2})\d*?0+$/, '$1').replace(/(\.\d{3})0$/, '$1')}`
  return n >= 100 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 10) return `${sec.toFixed(2)}s`
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const rem = sec - m * 60
  return `${m}m ${rem.toFixed(0)}s`
}

export function formatTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return '—'
  return tps >= 100 ? `${Math.round(tps)}` : tps.toFixed(1)
}

export function formatPct(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

/** Restrained semantic tier tones calibrated to AxonHub cutoffs without neon glare. */
export function cacheHitTone(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return 'text-muted-foreground'
  if (rate >= 0.9) return 'text-emerald-700 dark:text-emerald-400'
  if (rate >= 0.75) return 'text-sky-700 dark:text-sky-400'
  if (rate < 0.35) return 'text-amber-700 dark:text-amber-400'
  return 'text-foreground-secondary'
}

export function ttftTone(ttftMs: number | null | undefined): string {
  if (ttftMs == null || !Number.isFinite(ttftMs)) return 'text-muted-foreground'
  if (ttftMs <= 2500) return 'text-emerald-700 dark:text-emerald-400'
  if (ttftMs <= 5000) return 'text-sky-700 dark:text-sky-400'
  if (ttftMs > 15_000) return 'text-rose-700 dark:text-rose-400'
  if (ttftMs > 8000) return 'text-amber-700 dark:text-amber-400'
  return 'text-foreground'
}

export function tpsTone(tps: number | null | undefined, isStreamGen = true): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return 'text-muted-foreground'
  // Suppress colour above 500 tok/s (tiny decode-window measurement artefact, same as AxonHub).
  if (tps > 500) return 'text-foreground'
  const fast = isStreamGen ? 80 : 50
  const good = isStreamGen ? 45 : 28
  const slow = 12
  if (tps >= fast) return 'text-emerald-700 dark:text-emerald-400'
  if (tps >= good) return 'text-sky-700 dark:text-sky-400'
  if (tps < slow) return 'text-amber-700 dark:text-amber-400'
  return 'text-foreground'
}

export const tokensOf = (b: UsageBucket) => b.input + b.output + b.cacheRead + b.cacheWrite

type Layer = 'input' | 'cacheRead' | 'cacheWrite' | 'output'
/** Disciplined engineering palette — distinct ink/mineral tones without purple-cyan neon gradients. */
const LAYERS: { key: Layer; color: string }[] = [
  { key: 'input', color: '#476885' },
  { key: 'cacheRead', color: '#2e856e' },
  { key: 'cacheWrite', color: '#b8762e' },
  { key: 'output', color: '#8c5246' },
]

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  const left = w > 0 ? Math.min(Math.max(x, 84), Math.max(84, w - 84)) : x
  return (
    <div
      style={{ left }}
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-[1.45] text-popover-foreground shadow-md"
    >
      {children}
    </div>
  )
}

function usePointer() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; w: number }>({ x: 0, w: 0 })
  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: clientX - r.left, w: r.width })
  }
  return { ref, pos, move }
}

type DayMetric = 'tokens' | 'cost' | 'tps' | 'latency'

/**
 * Daily bars. Supports Tokens (stacked by input/cacheRead/cacheWrite/output), Cost,
 * Throughput (tok/s), and Latency (P50 / avg ms).
 */
export function DayChart({ days }: { days: UsageSummary['byDay'] }) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<DayMetric>('tokens')
  const [hidden, setHidden] = useState<Set<Layer>>(new Set())
  const [focus, setFocus] = useState<Layer | null>(null)
  const [hover, setHover] = useState<{ i: number; layer: Layer | null } | null>(null)
  const p = usePointer()
  const shown = LAYERS.filter((l) => !hidden.has(l.key))

  const valueOf = (d: UsageStatsBucket): number => {
    if (metric === 'cost') return d.cost
    if (metric === 'tps') return d.genTps ?? d.totalTps ?? 0
    if (metric === 'latency') return d.p50DurationMs ?? d.avgDurationMs ?? 0
    return shown.reduce((n, l) => n + d[l.key], 0)
  }

  const max = Math.max(1e-9, ...days.map(valueOf))
  const h = hover ? days[hover.i] : null
  const label = (k: Layer) => t(`settings:usage.${k}`)
  const step = days.length > 120 ? 30 : days.length > 31 ? 7 : days.length > 14 ? 3 : 1
  const toggle = (k: Layer) =>
    setHidden((s) => {
      const n = new Set(s)
      if (n.has(k)) {
        n.delete(k)
      } else if (n.size < LAYERS.length - 1) {
        n.add(k)
      }
      return n
    })

  const metricBarColor =
    metric === 'cost'
      ? 'var(--primary-semantic)'
      : metric === 'tps'
        ? '#2e856e'
        : '#476885'

  return (
    <div className="settings-flush">
      <div ref={p.ref} className="relative px-4 py-3.5" onMouseMove={(e) => p.move(e.clientX)} onMouseLeave={() => setHover(null)}>
      {h ? (
        <Tip x={p.pos.x} w={p.pos.w}>
          <div className="font-medium tabular-nums">
            {h.day} · {t('settings:usage.callsCount', { count: h.calls })} · {formatCost(h.cost)}
          </div>
          {metric === 'tokens' && hover?.layer ? (
            <div className="text-muted-foreground tabular-nums">
              {label(hover.layer)}: <span className="font-medium text-foreground">{formatTokens(h[hover.layer])}</span>
              {' / '}
              {formatTokens(tokensOf(h))}
            </div>
          ) : (
            <div className="text-muted-foreground tabular-nums">
              {formatTokens(tokensOf(h))} {t('settings:usage.tokensShort')}
              {(h.genTps ?? h.totalTps) != null ? ` · ${formatTps(h.genTps ?? h.totalTps)} tok/s` : ''}
              {(h.p50DurationMs ?? h.avgDurationMs) != null
                ? ` · P50 ${formatDurationMs(h.p50DurationMs ?? h.avgDurationMs)}`
                : ''}
            </div>
          )}
        </Tip>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label={t('settings:usage.metric')} className="settings-segmented flex h-[26px] gap-0.5 rounded-md p-0.5">
          {(
            [
              ['tokens', t('settings:usage.tokens')],
              ['cost', t('settings:usage.cost')],
              ['tps', t('settings:usage.tpsShort')],
              ['latency', t('settings:usage.latencyShort')],
            ] as const
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className="settings-segmented-item rounded-[4px] px-2.5 text-[11.5px]"
            >
              {lbl}
            </button>
          ))}
        </div>
        {metric === 'tokens' ? (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {LAYERS.map((l) => {
              const off = hidden.has(l.key)
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggle(l.key)}
                  onMouseEnter={() => !off && setFocus(l.key)}
                  onMouseLeave={() => setFocus(null)}
                  aria-pressed={!off}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-muted-foreground transition-opacity hover:bg-accent/50 hover:text-foreground',
                    off && 'line-through opacity-40',
                  )}
                >
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: l.color }} />
                  {label(l.key)}
                </button>
              )
            })}
          </div>
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {metric === 'cost'
              ? formatCost(max)
              : metric === 'tps'
                ? `${formatTps(max)} tok/s`
                : formatDurationMs(max)}
          </span>
        )}
      </div>

      <div className={cn('flex h-28 items-end', days.length > 90 ? 'gap-px' : 'gap-[3px]')}>
        {days.map((d, i) => {
          const v = valueOf(d)
          const barH = v > 0 ? Math.max(3, (v / max) * 100) : 0
          const active = hover?.i === i
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover({ i, layer: null })}>
              {barH === 0 ? (
                <div className="h-[2px] w-full rounded-sm bg-border/60" />
              ) : metric !== 'tokens' ? (
                <div
                  style={{ height: `${barH}%`, background: metricBarColor }}
                  className={cn(
                    'w-full rounded-t-[2px] transition-opacity',
                    hover && !active ? 'opacity-45' : 'opacity-85',
                  )}
                />
              ) : (
                <div style={{ height: `${barH}%` }} className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]">
                  {shown.map((l) => {
                    const lv = d[l.key]
                    if (lv <= 0) return null
                    const dim = (focus && focus !== l.key) || (hover && (!active || (hover.layer && hover.layer !== l.key)))
                    return (
                      <div
                        key={l.key}
                        onMouseEnter={(e) => {
                          e.stopPropagation()
                          setHover({ i, layer: l.key })
                        }}
                        style={{ flexGrow: lv, background: l.color }}
                        className={cn('w-full transition-opacity', dim && 'opacity-30')}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-1.5 flex text-[10px] tabular-nums text-muted-foreground">
        {days.map((d, i) => (
          <div key={d.day} className="min-w-0 flex-1 truncate">
            {i % step === 0 ? d.day.slice(5) : ''}
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

const HEAT_STEPS = [0.22, 0.45, 0.7, 0.94]
const HEAT_BASE_COLOR = '#267a63'
function heatFill(v: number, max: number): string {
  if (v <= 0 || max <= 0) return 'color-mix(in srgb, var(--border-base) 42%, transparent)'
  const ratio = v / max
  const i = ratio >= 0.78 ? 3 : ratio >= 0.48 ? 2 : ratio >= 0.2 ? 1 : 0
  return `color-mix(in srgb, ${HEAT_BASE_COLOR} ${Math.round(HEAT_STEPS[i] * 100)}%, var(--bg-base))`
}

/** GitHub-style calendar: one column per week (Monday first), one cell per day, coloured by cost or tokens. */
export function CalendarHeatmap({ days, metric }: { days: UsageSummary['byDay']; metric: 'cost' | 'tokens' }) {
  const { t } = useTranslation()
  const p = usePointer()
  const [hover, setHover] = useState<number | null>(null)
  const weeks = useMemo(() => {
    if (!days.length) return [] as (number | null)[][]
    const [y, m, d] = days[0].day.split('-').map(Number)
    const lead = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    const cells: (number | null)[] = [...new Array<null>(lead).fill(null), ...days.map((_, i) => i)]
    const out: (number | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [days])
  const val = (d: UsageBucket) => (metric === 'cost' ? d.cost : tokensOf(d))
  const max = Math.max(0, ...days.map(val))
  const h = hover !== null ? days[hover] : null
  const months = weeks.map((col, ci) => {
    const di = col.find((x): x is number => x !== null)
    if (di === undefined) return ''
    const ym = days[di].day.slice(0, 7)
    const prev = ci > 0 ? weeks[ci - 1].find((x): x is number => x !== null) : undefined
    return prev === undefined || days[prev].day.slice(0, 7) !== ym ? days[di].day.slice(5, 7) : ''
  })

  return (
    <div className="settings-flush">
      <div ref={p.ref} className="relative px-4 py-3.5" onMouseMove={(e) => p.move(e.clientX)} onMouseLeave={() => setHover(null)}>
      {h ? (
        <Tip x={p.pos.x} w={p.pos.w}>
          <span className="font-medium tabular-nums">{h.day}</span>
          {' · '}
          <span className="tabular-nums">
            {h.calls > 0
              ? `${t('settings:usage.callsCount', { count: h.calls })} · ${formatTokens(tokensOf(h))} · ${formatCost(h.cost)}`
              : t('settings:usage.callsCount', { count: 0 })}
          </span>
        </Tip>
      ) : null}
      <div className="overflow-x-auto overflow-y-hidden pb-0.5">
        <div className="inline-flex gap-1.5">
          <div className="grid grid-rows-7 gap-[3px] pt-4 text-[10px] leading-[11px] text-muted-foreground">
            {[0, 1, 2, 3, 4, 5, 6].map((w) => (
              <span key={w} className="h-[11px]">
                {w % 2 === 0 ? t(`settings:usage.weekdayShort.${w}`) : ''}
              </span>
            ))}
          </div>
          <div>
            <div className="mb-1 flex gap-[3px] text-[10px] leading-3 tabular-nums text-muted-foreground">
              {months.map((m, ci) => (
                <span key={ci} className="w-[11px]">
                  {m}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {weeks.map((col, ci) => (
                <div key={ci} className="grid grid-rows-7 gap-[3px]">
                  {[0, 1, 2, 3, 4, 5, 6].map((ri) => {
                    const di = col[ri] ?? null
                    if (di === null) return <span key={ri} className="h-[11px] w-[11px]" />
                    const d = days[di]
                    return (
                      <span
                        key={ri}
                        onMouseEnter={() => setHover(di)}
                        style={{ background: heatFill(val(d), max) }}
                        className={cn('h-[11px] w-[11px] rounded-[2px]', hover === di && 'ring-1 ring-foreground/60')}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

const HOUR_GRID_STYLE = { gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' } as const

/** Weekday (7 rows) × hour of day (24 columns, local time) compact matrix. */
export function HourHeatmap({ heat, metric }: { heat: UsageSummary['heat']; metric: 'calls' | 'cost' }) {
  const { t } = useTranslation()
  const p = usePointer()
  const [hover, setHover] = useState<number | null>(null)
  const data = metric === 'cost' ? heat.cost : heat.calls
  const max = Math.max(0, ...data)

  const peakIdx = useMemo(() => {
    let best = -1
    let bestVal = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] > bestVal) {
        bestVal = data[i]
        best = i
      }
    }
    return best
  }, [data])

  return (
    <div className="settings-flush">
      <div
        ref={p.ref}
        className="relative px-4 py-3.5"
        onMouseMove={(e) => p.move(e.clientX)}
        onMouseLeave={() => setHover(null)}
      >
      {hover !== null ? (
        <Tip x={p.pos.x} w={p.pos.w}>
          <span className="font-medium tabular-nums">
            {t(`settings:usage.weekdayShort.${Math.floor(hover / 24)}`)} {String(hover % 24).padStart(2, '0')}:00
          </span>
          {' · '}
          <span className="tabular-nums">
            {t('settings:usage.callsCount', { count: heat.calls[hover] })} · {formatTokens(heat.tokens[hover])} · {formatCost(heat.cost[hover])}
          </span>
        </Tip>
      ) : null}

      {/* Compact header strip: Peak slot + 5-step intensity legend */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {peakIdx >= 0
            ? t('settings:usage.peakSlot', {
                day: t(`settings:usage.weekdayShort.${Math.floor(peakIdx / 24)}`),
                hour: String(peakIdx % 24).padStart(2, '0'),
                calls: heat.calls[peakIdx],
                cost: formatCost(heat.cost[peakIdx]),
              })
            : '\u00a0'}
        </span>
        <div className="flex items-center gap-1 text-[10px]">
          <span>{t('settings:usage.less')}</span>
          {[0, 0.15, 0.35, 0.65, 1].map((lv, idx) => (
            <span
              key={idx}
              style={{ background: heatFill(lv, 1) }}
              className="h-2.5 w-2.5 rounded-[2px]"
            />
          ))}
          <span>{t('settings:usage.more')}</span>
        </div>
      </div>

      <div className="flex flex-col gap-[3px]" data-testid="hour-heatmap-matrix">
        {[0, 1, 2, 3, 4, 5, 6].map((w) => (
          <div key={w} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-[10.5px] leading-none text-muted-foreground">
              {t(`settings:usage.weekdayShort.${w}`)}
            </span>
            <div className="grid flex-1 gap-[3px]" style={HOUR_GRID_STYLE}>
              {Array.from({ length: 24 }, (_, hr) => {
                const idx = w * 24 + hr
                return (
                  <span
                    key={hr}
                    onMouseEnter={() => setHover(idx)}
                    style={{ background: heatFill(data[idx], max) }}
                    className={cn(
                      'h-[16px] rounded-[3px] transition-shadow',
                      hover === idx && 'ring-1.5 ring-foreground/75',
                    )}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span className="w-5 shrink-0" />
          <div className="grid flex-1 gap-[3px]" style={HOUR_GRID_STYLE}>
            {Array.from({ length: 24 }, (_, hr) => (
              <span key={hr} className="leading-none">
                {hr % 3 === 0 ? String(hr).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
