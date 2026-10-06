import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'
import { cn } from '@renderer/lib/utils'

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '')}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

export function formatCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}

export const tokensOf = (b: UsageBucket) => b.input + b.output + b.cacheRead + b.cacheWrite

type Layer = 'input' | 'cacheRead' | 'cacheWrite' | 'output'
/** pi-ui chart palette (`--uib-c*`), inlined: those tokens load with the markdown renderer, not settings. */
const LAYERS: { key: Layer; color: string }[] = [
  { key: 'input', color: '#5b6fd8' },
  { key: 'cacheRead', color: '#14a085' },
  { key: 'cacheWrite', color: '#ec8a3a' },
  { key: 'output', color: '#d8547b' },
]

/** Small tooltip that follows the pointer inside a `relative` container. */
function Tip({ at, children }: { at: { x: number; y: number; w: number } | null; children: ReactNode }) {
  if (!at) return null
  const left = Math.min(Math.max(at.x, 90), at.w - 90)
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-popover-foreground shadow-md"
      style={{ left, top: at.y - 8 }}
    >
      {children}
    </div>
  )
}

function usePointer() {
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number; w: number } | null>(null)
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const zoom = Number(document.documentElement.style.zoom) || 1
    setAt({ x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom, w: r.width / zoom })
  }
  return { ref, at, move, clear: () => setAt(null) }
}

/**
 * Daily bars. Tokens: stacked by kind; each layer is its own hover target, and legend entries
 * toggle (click) or highlight (hover) a layer. Cost: one bar per day.
 */
export function DayChart({ days }: { days: UsageSummary['byDay'] }) {
  const { t } = useTranslation()
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const [hidden, setHidden] = useState<Set<Layer>>(new Set())
  const [focus, setFocus] = useState<Layer | null>(null)
  const [hover, setHover] = useState<{ i: number; layer: Layer | null } | null>(null)
  const p = usePointer()
  const shown = LAYERS.filter((l) => !hidden.has(l.key))
  const valueOf = (d: UsageBucket) => (metric === 'cost' ? d.cost : shown.reduce((n, l) => n + d[l.key], 0))
  const max = Math.max(1e-9, ...days.map(valueOf))
  const h = hover ? days[hover.i] : null
  const label = (k: Layer) => t(`settings:usage.${k}`)
  // A tick roughly every week (or month for long ranges) keeps the axis readable.
  const step = days.length > 120 ? 30 : days.length > 31 ? 7 : days.length > 14 ? 3 : 1

  return (
    <div className="settings-row flex-col !items-stretch gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        <div role="radiogroup" aria-label={t('settings:usage.metric')} className="settings-segmented flex h-[24px] gap-0.5 rounded-md p-0.5">
          {(['tokens', 'cost'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)} className="settings-segmented-item rounded-[4px] px-2 text-[11.5px]">
              {t(`settings:usage.${m}`)}
            </button>
          ))}
        </div>
        {metric === 'tokens'
          ? LAYERS.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={!hidden.has(l.key)}
                className={cn('flex items-center gap-1.5 rounded px-1 hover:text-foreground', hidden.has(l.key) && 'opacity-40')}
                onMouseEnter={() => setFocus(l.key)}
                onMouseLeave={() => setFocus(null)}
                onClick={() =>
                  setHidden((s) => {
                    const n = new Set(s)
                    if (n.has(l.key)) n.delete(l.key)
                    else if (n.size < LAYERS.length - 1) n.add(l.key)
                    return n
                  })
                }
              >
                <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
                {label(l.key)}
              </button>
            ))
          : null}
      </div>
      <div ref={p.ref} className="relative" onMouseMove={p.move} onMouseLeave={() => { p.clear(); setHover(null) }}>
        <div className="flex h-40 items-end gap-[2px]">
          {days.map((d, i) => {
            const v = valueOf(d)
            const pct = (v / max) * 100
            return (
              <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover({ i, layer: null })}>
                <div
                  className={cn('flex w-full flex-col-reverse overflow-hidden rounded-[3px] transition-opacity', hover && hover.i !== i && 'opacity-50')}
                  style={{ height: `${pct}%`, minHeight: v > 0 ? 2 : 0 }}
                >
                  {metric === 'cost' ? (
                    <div className="h-full w-full" style={{ background: '#8a6bd4' }} />
                  ) : (
                    shown.map((l) =>
                      d[l.key] ? (
                        <div
                          key={l.key}
                          onMouseEnter={() => setHover({ i, layer: l.key })}
                          className={cn('w-full transition-opacity', focus && focus !== l.key && 'opacity-25', hover?.i === i && hover.layer === l.key && 'brightness-110')}
                          style={{ height: `${(d[l.key] / v) * 100}%`, background: l.color }}
                        />
                      ) : null,
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <Tip at={h ? p.at : null}>
          {h ? (
            <>
              <div className="font-medium text-foreground">{h.day}</div>
              {hover?.layer && metric === 'tokens' ? (
                <div>
                  {label(hover.layer)} {formatTokens(h[hover.layer])}
                  <span className="text-muted-foreground"> · {tokensOf(h) ? Math.round((h[hover.layer] / tokensOf(h)) * 100) : 0}%</span>
                </div>
              ) : null}
              <div className="text-muted-foreground">
                {formatTokens(tokensOf(h))} {t('settings:usage.tokensShort')} · {formatCost(h.cost)} · {t('settings:usage.callsCount', { count: h.calls })}
              </div>
            </>
          ) : null}
        </Tip>
      </div>
      {days.length > 1 ? (
        <div className="relative h-3 text-[10.5px] tabular-nums text-muted-foreground">
          {days.map((d, i) =>
            i % step === 0 || i === days.length - 1 ? (
              <span
                key={d.day}
                className={cn('absolute whitespace-nowrap', i === 0 ? '' : i === days.length - 1 ? '-translate-x-full' : '-translate-x-1/2')}
                style={{ left: i === 0 ? 0 : i === days.length - 1 ? '100%' : `${((i + 0.5) / days.length) * 100}%` }}
              >
                {d.day.slice(5)}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  )
}

const HEAT_STEPS = [0.12, 0.3, 0.5, 0.72, 1]
function heatColor(v: number, max: number): string {
  if (v <= 0 || max <= 0) return 'hsl(var(--muted))'
  const i = Math.min(HEAT_STEPS.length - 1, Math.floor((v / max) * HEAT_STEPS.length))
  return `color-mix(in srgb, var(--primary-semantic) ${Math.round(HEAT_STEPS[i] * 100)}%, transparent)`
}

/** GitHub-style calendar: one column per week (Monday first), one cell per day, coloured by cost or tokens. */
export function CalendarHeatmap({ days, metric }: { days: UsageSummary['byDay']; metric: 'cost' | 'tokens' }) {
  const { t } = useTranslation()
  const p = usePointer()
  const [hover, setHover] = useState<number | null>(null)
  const weeks = useMemo(() => {
    if (!days.length) return [] as (number | null)[][]
    const lead = (new Date(`${days[0].day}T00:00:00Z`).getUTCDay() + 6) % 7
    const cells: (number | null)[] = [...new Array<null>(lead).fill(null), ...days.map((_, i) => i)]
    const out: (number | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [days])
  const val = (d: UsageBucket) => (metric === 'cost' ? d.cost : tokensOf(d))
  const max = Math.max(0, ...days.map(val))
  const h = hover !== null ? days[hover] : null
  // Month name over the first week that starts in it.
  const months = weeks.map((col, ci) => {
    const di = col.find((x): x is number => x !== null)
    if (di === undefined) return ''
    const m = days[di].day.slice(5, 7)
    const prev = ci > 0 ? weeks[ci - 1].find((x): x is number => x !== null) : undefined
    return ci === 0 || (prev !== undefined && days[prev].day.slice(5, 7) !== m) ? new Date(`${days[di].day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }) : ''
  })
  const CELL = 'h-[13px] w-[13px]'
  return (
    <div ref={p.ref} className="relative overflow-x-auto" onMouseMove={p.move} onMouseLeave={() => { p.clear(); setHover(null) }}>
      <div className="flex gap-[3px] pl-[2.2rem] text-[10px] leading-[14px] text-muted-foreground">
        {months.map((m, ci) => (
          <span key={ci} className="w-[13px] shrink-0 overflow-visible whitespace-nowrap">{m}</span>
        ))}
      </div>
      <div className="flex gap-[3px]">
        <div className="flex w-[2.2rem] shrink-0 flex-col gap-[3px] text-[10px] leading-[13px] text-muted-foreground">
          {[0, 1, 2, 3, 4, 5, 6].map((w) => (
            <span key={w} className="h-[13px]">{w % 2 === 0 ? t(`settings:usage.weekdayShort.${w}`) : ''}</span>
          ))}
        </div>
        {weeks.map((col, ci) => (
          <div key={ci} className="flex shrink-0 flex-col gap-[3px]">
            {col.map((di, ri) =>
              di === null ? (
                <span key={ri} className={CELL} />
              ) : (
                <span
                  key={ri}
                  className={cn(CELL, 'rounded-[3px]', hover === di && 'ring-1 ring-foreground/60')}
                  style={{ background: heatColor(val(days[di]), max) }}
                  onMouseEnter={() => setHover(di)}
                />
              ),
            )}
          </div>
        ))}
      </div>
      <Tip at={h ? p.at : null}>
        {h ? (
          <>
            <div className="font-medium text-foreground">{h.day}</div>
            <div className="text-muted-foreground">
              {formatCost(h.cost)} · {formatTokens(tokensOf(h))} {t('settings:usage.tokensShort')} · {t('settings:usage.callsCount', { count: h.calls })}
            </div>
          </>
        ) : null}
      </Tip>
    </div>
  )
}

/** Weekday × hour of day (local time): when the requests happen. */
export function HourHeatmap({ heat, metric }: { heat: UsageSummary['heat']; metric: 'calls' | 'cost' }) {
  const { t } = useTranslation()
  const p = usePointer()
  const [hover, setHover] = useState<number | null>(null)
  const data = metric === 'cost' ? heat.cost : heat.calls
  const max = Math.max(0, ...data)
  return (
    <div ref={p.ref} className="relative" onMouseMove={p.move} onMouseLeave={() => { p.clear(); setHover(null) }}>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `2.2rem repeat(24, minmax(0, 1fr))` }}>
        {[0, 1, 2, 3, 4, 5, 6].map((w) => (
          <div key={w} className="contents">
            <span className="text-[10px] leading-[14px] text-muted-foreground">{t(`settings:usage.weekdayShort.${w}`)}</span>
            {Array.from({ length: 24 }, (_, hr) => {
              const i = w * 24 + hr
              return (
                <span
                  key={hr}
                  className={cn('h-[14px] rounded-[2px]', hover === i && 'ring-1 ring-foreground/60')}
                  style={{ background: heatColor(data[i], max) }}
                  onMouseEnter={() => setHover(i)}
                />
              )
            })}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, hr) => (
          <span key={hr} className="text-center text-[10px] tabular-nums text-muted-foreground">{hr % 3 === 0 ? hr : ''}</span>
        ))}
      </div>
      <Tip at={hover !== null ? p.at : null}>
        {hover !== null ? (
          <>
            <div className="font-medium text-foreground">
              {t(`settings:usage.weekdayShort.${Math.floor(hover / 24)}`)} {String(hover % 24).padStart(2, '0')}:00–{String((hover % 24) + 1).padStart(2, '0')}:00
            </div>
            <div className="text-muted-foreground">
              {t('settings:usage.callsCount', { count: heat.calls[hover] })} · {formatCost(heat.cost[hover])} · {formatTokens(heat.tokens[hover])} {t('settings:usage.tokensShort')}
            </div>
          </>
        ) : null}
      </Tip>
    </div>
  )
}
