import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageLogPage, UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import {
  buildHomeUsageViewModel,
  formatHomeDuration,
  formatHomeTokens,
  type ActivityWeekCol,
  type CumulativePoint,
  type HomeUsageViewModel,
} from './home-usage-metrics'

type ActivityTab = 'daily' | 'weekly' | 'cumulative'

let cachedSummary: UsageSummary | null = null
let cachedLongestMs: number | null = null

const GRID_52_STYLE = { gridTemplateColumns: 'repeat(52, minmax(0, 1fr))' } as const

function cellFillStyle(tokens: number, maxTokens: number): string | undefined {
  if (tokens <= 0 || maxTokens <= 0) return undefined
  const ratio = tokens / maxTokens
  if (ratio >= 0.72) return '#7dd3fc'
  if (ratio >= 0.42) return '#38bdf8'
  if (ratio >= 0.16) return '#0284c7'
  return '#075985'
}

function MonthAxis({ weeks }: { weeks: ActivityWeekCol[] }) {
  const { t } = useTranslation()
  return (
    <div className="mt-2 grid gap-[3px] select-none" style={GRID_52_STYLE}>
      {weeks.map((w) => (
        <div key={w.index} className="relative h-4">
          {w.month ? (
            <span className="absolute left-0 top-0 whitespace-nowrap text-[11px] text-foreground-secondary/65">
              {t(`common:homeUsage.months.${w.month}`)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function DailyHeatmapGrid({
  weeks,
  maxTokens,
  onHoverText,
}: {
  weeks: ActivityWeekCol[]
  maxTokens: number
  onHoverText: (text: string | null) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <div onMouseLeave={() => onHoverText(null)}>
      <div className="grid gap-[3px]" style={GRID_52_STYLE} data-testid="home-usage-daily-grid">
        {weeks.map((col) => (
          <div key={col.index} className="flex flex-col gap-[3px]">
            {col.cells.map((cell) => {
              if (cell.future) return <span key={cell.day} className="aspect-square w-full" />
              const fill = cellFillStyle(cell.tokens, maxTokens)
              return (
                <span
                  key={cell.day}
                  onMouseEnter={() =>
                    onHoverText(
                      `${cell.day} · ${formatHomeTokens(cell.tokens, i18n.language)} · ${t('common:homeUsage.callsCount', { count: cell.calls })}`,
                    )
                  }
                  style={fill ? { backgroundColor: fill } : undefined}
                  className={cn(
                    'aspect-square w-full rounded-[3px] transition-transform hover:scale-125',
                    !fill && 'bg-foreground/[0.07] dark:bg-white/[0.08]',
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
      <MonthAxis weeks={weeks} />
    </div>
  )
}

function WeeklyBarsGrid({
  weeks,
  maxTokens,
  onHoverText,
}: {
  weeks: ActivityWeekCol[]
  maxTokens: number
  onHoverText: (text: string | null) => void
}) {
  const { t, i18n } = useTranslation()
  const safeMax = Math.max(1, maxTokens)
  return (
    <div onMouseLeave={() => onHoverText(null)}>
      <div className="grid h-[96px] items-end gap-[3px]" style={GRID_52_STYLE} data-testid="home-usage-weekly-bars">
        {weeks.map((w) => {
          const pct = w.tokens > 0 ? Math.max(8, Math.round((w.tokens / safeMax) * 100)) : 4
          return (
            <div
              key={w.index}
              onMouseEnter={() =>
                onHoverText(
                  `${t('common:homeUsage.weekOf', { start: w.startDay.slice(5), end: w.endDay.slice(5) })} · ${formatHomeTokens(w.tokens, i18n.language)}`,
                )
              }
              className="flex h-full items-end"
            >
              <span
                style={{
                  height: `${pct}%`,
                  backgroundColor: w.tokens > 0 ? '#38bdf8' : undefined,
                }}
                className={cn(
                  'w-full rounded-[2px] transition-opacity hover:opacity-100',
                  w.tokens > 0 ? 'opacity-85' : 'bg-foreground/[0.07] dark:bg-white/[0.08]',
                )}
              />
            </div>
          )
        })}
      </div>
      <MonthAxis weeks={weeks} />
    </div>
  )
}

function buildSvgPaths(points: CumulativePoint[]): { lineD: string; areaD: string } {
  const maxVal = Math.max(1, points[points.length - 1]?.totalTokens ?? 0)
  const minVal = points[0]?.totalTokens ?? 0
  const span = Math.max(1, maxVal - minVal)
  const coords = points.map((pt, idx) => {
    const x = (idx / Math.max(1, points.length - 1)) * 520
    const y = 90 - ((pt.totalTokens - minVal) / span) * 80
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const lineD = `M ${coords.join(' L ')}`
  return { lineD, areaD: `${lineD} L 520,96 L 0,96 Z` }
}

function CumulativeAreaChart({
  weeks,
  points,
  onHoverText,
}: {
  weeks: ActivityWeekCol[]
  points: CumulativePoint[]
  onHoverText: (text: string | null) => void
}) {
  const { i18n } = useTranslation()
  const { lineD, areaD } = buildSvgPaths(points)

  return (
    <div onMouseLeave={() => onHoverText(null)}>
      <div className="relative h-[96px] w-full" data-testid="home-usage-cumulative-chart">
        <svg viewBox="0 0 520 96" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="piHomeCumGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#piHomeCumGrad)" />
          <path d={lineD} fill="none" stroke="#38bdf8" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-0 grid" style={GRID_52_STYLE}>
          {points.map((pt, idx) => (
            <span
              key={pt.label + idx}
              onMouseEnter={() => onHoverText(`${pt.label} · ${formatHomeTokens(pt.totalTokens, i18n.language)}`)}
              className="h-full w-full hover:bg-foreground/[0.04]"
            />
          ))}
        </div>
      </div>
      <MonthAxis weeks={weeks} />
    </div>
  )
}

function StatsPillBar({ vm }: { vm: HomeUsageViewModel }) {
  const { t, i18n } = useTranslation()
  const stats = [
    { value: formatHomeTokens(vm.totalTokens, i18n.language), label: t('common:homeUsage.totalTokens') },
    { value: formatHomeTokens(vm.peakDailyTokens, i18n.language), label: t('common:homeUsage.peakDailyTokens') },
    { value: formatHomeDuration(vm.longestTaskMs, i18n.language), label: t('common:homeUsage.longestTask') },
    { value: t('common:homeUsage.daysCount', { count: vm.longestStreak }), label: t('common:homeUsage.longestStreak') },
    { value: t('common:homeUsage.daysCount', { count: vm.currentStreak }), label: t('common:homeUsage.currentStreak') },
  ]
  return (
    <div
      data-testid="home-usage-stats-bar"
      className="grid grid-cols-2 gap-y-3 rounded-2xl border border-border/60 bg-card/30 px-2 py-3.5 sm:grid-cols-5 sm:gap-y-0 sm:divide-x sm:divide-border/50"
    >
      {stats.map((item) => (
        <div key={item.label} className="flex flex-col items-center justify-center px-2 text-center">
          <span className="text-[14.5px] font-semibold tracking-tight tabular-nums text-foreground">
            {item.value}
          </span>
          <span className="mt-0.5 text-[11.5px] text-foreground-secondary/70">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function useHomeUsageData(): HomeUsageViewModel {
  const [summary, setSummary] = useState<UsageSummary | null>(() => cachedSummary)
  const [longestMs, setLongestMs] = useState<number | null>(() => cachedLongestMs)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      ipcClient.invoke('usage.summary', { days: 0 }).catch(() => null) as Promise<UsageSummary | null>,
      ipcClient
        .invoke('usage.logs', { days: 0, sortBy: 'duration', sortDir: 'desc', limit: 1 })
        .catch(() => null) as Promise<UsageLogPage | null>,
    ]).then(([sumRes, logRes]) => {
      if (cancelled) return
      if (sumRes) {
        cachedSummary = sumRes
        setSummary(sumRes)
      }
      const dur = logRes?.rows?.[0]?.durationMs ?? null
      cachedLongestMs = dur
      setLongestMs(dur)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => buildHomeUsageViewModel(summary, longestMs), [summary, longestMs])
}

export function HomeUsageOverview() {
  const { t } = useTranslation()
  const vm = useHomeUsageData()
  const [tab, setTab] = useState<ActivityTab>('daily')
  const [hoverInfo, setHoverInfo] = useState<string | null>(null)
  const tabs: { key: ActivityTab; label: string }[] = [
    { key: 'daily', label: t('common:homeUsage.tabDaily') },
    { key: 'weekly', label: t('common:homeUsage.tabWeekly') },
    { key: 'cumulative', label: t('common:homeUsage.tabCumulative') },
  ]

  return (
    <div className="w-full max-w-[740px] select-none" data-testid="home-usage-overview">
      <StatsPillBar vm={vm} />
      <div className="mt-5">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-[13px] font-semibold text-foreground">{t('common:homeUsage.tokenActivity')}</span>
            {hoverInfo ? (
              <span className="truncate font-mono text-[11px] tabular-nums text-foreground-secondary/80">{hoverInfo}</span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[12px]">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={tab === item.key}
                onClick={() => setTab(item.key)}
                className={cn(
                  'transition-colors',
                  tab === item.key ? 'font-semibold text-foreground' : 'text-foreground-secondary/65 hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {tab === 'daily' ? (
          <DailyHeatmapGrid weeks={vm.weeks} maxTokens={vm.maxDayTokens} onHoverText={setHoverInfo} />
        ) : tab === 'weekly' ? (
          <WeeklyBarsGrid weeks={vm.weeks} maxTokens={vm.maxWeekTokens} onHoverText={setHoverInfo} />
        ) : (
          <CumulativeAreaChart weeks={vm.weeks} points={vm.cumulative} onHoverText={setHoverInfo} />
        )}
      </div>
    </div>
  )
}
