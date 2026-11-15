import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageStatsBucket, UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingsSection } from '@renderer/features/settings/settings-page-shared'
import {
  cacheHitTone,
  CalendarHeatmap,
  DayChart,
  formatCost,
  formatDurationMs,
  formatPct,
  formatTokens,
  formatTps,
  HourHeatmap,
  tokensOf,
  tpsTone,
  ttftTone,
} from './usage-charts'
import { UsageLogsTable } from './usage-logs-table'

/** Days back from today; 0 = all time. */
type Range = 1 | 7 | 30 | 90 | 365 | 0
type UsageView = 'overview' | 'logs'

const projectName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

function RankRow({
  label,
  sub,
  bucket,
  max,
  onClick,
}: {
  label: string
  sub?: string
  bucket: UsageStatsBucket
  max: number
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('settings-row relative w-full text-left', onClick && 'hover:bg-accent/40')}
    >
      <div className="flex w-full items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-foreground">{label}</div>
          {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
        </div>
        <div className="flex shrink-0 items-baseline gap-3 font-mono text-[12px] tabular-nums text-muted-foreground">
          {bucket.cacheHitRate != null && bucket.cacheRead > 0 ? (
            <span className={cn('hidden sm:inline text-[11px]', cacheHitTone(bucket.cacheHitRate))}>
              {formatPct(bucket.cacheHitRate)}
            </span>
          ) : null}
          {(bucket.genTps ?? bucket.totalTps) != null ? (
            <span className="hidden md:inline text-[11px]">
              {formatTps(bucket.genTps ?? bucket.totalTps)} tok/s
            </span>
          ) : null}
          <span>{formatTokens(tokensOf(bucket))}</span>
          <span className="w-16 text-right font-semibold text-foreground">{formatCost(bucket.cost)}</span>
        </div>
      </div>
      <div
        style={{ width: `${Math.min(100, (bucket.cost / max) * 100)}%` }}
        className="mt-1.5 h-[2px] rounded-full bg-primary/45"
      />
    </Tag>
  )
}

function ModelPerfTable({
  models,
  maxCost,
  onSelectModel,
}: {
  models: UsageSummary['byModel']
  maxCost: number
  onSelectModel: (model: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="settings-flush overflow-x-auto">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-border/60 bg-[var(--bg-elevated)]/30 text-[11px] font-semibold tracking-wide text-muted-foreground">
            <th className="px-4 py-2">{t('settings:usage.colModel')}</th>
            <th className="px-3 py-2 text-right">{t('settings:usage.colCalls')}</th>
            <th className="px-3 py-2 text-right">{t('settings:usage.colTokens')}</th>
            <th className="px-3 py-2 text-right">{t('settings:usage.colCache')}</th>
            <th className="px-3 py-2 text-right">{t('settings:usage.colLatency')}</th>
            <th className="px-3 py-2 text-right">{t('settings:usage.colTps')}</th>
            <th className="px-4 py-2 text-right">{t('settings:usage.colCost')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {models.map((m) => (
            <tr
              key={m.model}
              onClick={() => onSelectModel(m.model)}
              className="cursor-pointer transition-colors hover:bg-accent/40"
            >
              <td className="max-w-[260px] px-4 py-2.5">
                <div className="truncate font-mono text-[12.5px] font-medium text-foreground" title={m.model}>
                  {m.model}
                </div>
                <div
                  style={{ width: `${Math.max(2, Math.min(100, (m.cost / maxCost) * 100))}%` }}
                  className="mt-1.5 h-[2px] rounded-full bg-primary/50"
                />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                <div className="text-foreground">{m.calls.toLocaleString()}</div>
                {(m.errorCalls > 0 || m.abortedCalls > 0) ? (
                  <div className="text-[10px] text-amber-700 dark:text-amber-400">
                    {m.errorCalls > 0 ? `${m.errorCalls} err` : ''}
                    {m.errorCalls > 0 && m.abortedCalls > 0 ? ' · ' : ''}
                    {m.abortedCalls > 0 ? `${m.abortedCalls} abort` : ''}
                  </div>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                <div className="font-medium text-foreground">{formatTokens(tokensOf(m))}</div>
                <div className="text-[10.5px] text-muted-foreground">
                  {formatTokens(m.input)} / {formatTokens(m.output)}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                <div className={cn('font-medium', cacheHitTone(m.cacheHitRate))}>
                  {m.cacheRead > 0 ? formatPct(m.cacheHitRate) : '—'}
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {m.cacheRead > 0 ? formatTokens(m.cacheRead) : '0'}
                  {m.cacheWrite > 0 ? ` · +${formatTokens(m.cacheWrite)}` : ''}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                <div className={cn('text-[11.5px]', ttftTone(m.p50TtftMs ?? m.avgTtftMs))}>
                  {m.ttftCalls > 0 ? `${t('settings:usage.ttftShort')} ${formatDurationMs(m.p50TtftMs ?? m.avgTtftMs)}` : `${t('settings:usage.ttftShort')} —`}
                </div>
                <div className="text-[10.5px] text-muted-foreground">
                  {formatDurationMs(m.p50DurationMs ?? m.avgDurationMs)}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                {m.genTps != null ? (
                  <>
                    <div className={cn('font-medium', tpsTone(m.genTps, true))}>{formatTps(m.genTps)} tok/s</div>
                    <div className="text-[10.5px] text-muted-foreground">
                      {t('settings:usage.tpsTotal', { value: formatTps(m.totalTps) })}
                    </div>
                  </>
                ) : m.totalTps != null ? (
                  <>
                    <div className={cn('font-medium', tpsTone(m.totalTps, false))}>{formatTps(m.totalTps)} tok/s</div>
                    <div className="text-[10px] text-muted-foreground">E2E</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[12.5px] font-semibold tabular-nums text-foreground">
                {formatCost(m.cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MetricToggle<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K
  options: [K, string][]
  onChange: (v: K) => void
}) {
  return (
    <div role="radiogroup" className="settings-segmented flex h-[24px] gap-0.5 rounded-md p-0.5">
      {options.map(([k, l]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className="settings-segmented-item rounded-[4px] px-2 text-[11px]"
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/**
 * Local usage dashboard + AxonHub-inspired request logs & in-place `.jsonl` payload inspector.
 */
export function UsageSettingsPanel() {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>(7)
  const [view, setView] = useState<UsageView>('overview')
  const [logFilterModel, setLogFilterModel] = useState('')
  const [logFilterProject, setLogFilterProject] = useState('')
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [heatMetric, setHeatMetric] = useState<'cost' | 'tokens'>('cost')
  const [hourMetric, setHourMetric] = useState<'calls' | 'cost'>('calls')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(false)
    ipcClient
      .invoke('usage.summary', { days: range })
      .then((r: UsageSummary) => live && setData(r))
      .catch(() => live && setError(true))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [range])

  const maxModel = useMemo(() => Math.max(1e-9, ...(data?.byModel ?? []).map((m) => m.cost)), [data])
  const maxProject = useMemo(() => Math.max(1e-9, ...(data?.byProject ?? []).map((m) => m.cost)), [data])
  const maxSession = useMemo(() => Math.max(1e-9, ...(data?.topSessions ?? []).map((m) => m.cost)), [data])
  const peak = useMemo(
    () => (data?.byDay ?? []).reduce<UsageSummary['byDay'][number] | null>((best, d) => (!best || d.cost > best.cost ? d : best), null),
    [data],
  )

  const ranges: { v: Range; l: string }[] = [
    { v: 1, l: t('settings:usage.today') },
    { v: 7, l: t('settings:usage.days', { count: 7 }) },
    { v: 30, l: t('settings:usage.days', { count: 30 }) },
    { v: 90, l: t('settings:usage.days', { count: 90 }) },
    { v: 365, l: t('settings:usage.year') },
    { v: 0, l: t('settings:usage.all') },
  ]

  const total = data?.total
  const calendarDays = data?.byDay.length ?? 0

  const openSession = (sessionFile: string, project: string, entryId?: string) => {
    window.dispatchEvent(
      new CustomEvent('pi-desktop:open-session', {
        detail: {
          sessionFile,
          workspaceId: project === '(unknown)' ? undefined : project,
          entryId,
        },
      }),
    )
  }

  const jumpToModelLogs = (model: string) => {
    setLogFilterProject('')
    setLogFilterModel(model)
    setView('logs')
  }

  const jumpToProjectLogs = (project: string) => {
    setLogFilterModel('')
    setLogFilterProject(project)
    setView('logs')
  }

  const totalTokensVal = total ? tokensOf(total) : 0

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeader title={t('settings:usage.title')} description={t('settings:usage.description')} />

      {/* Shared toolbar: Date range + Overview / Request Logs switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label={t('settings:usage.range')} className="settings-segmented flex h-[30px] w-fit gap-0.5 rounded-md p-0.5">
          {ranges.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={range === o.v}
              onClick={() => setRange(o.v)}
              className="settings-segmented-item rounded-[5px] px-3 text-[12px]"
            >
              {o.l}
            </button>
          ))}
        </div>

        <div role="tablist" className="settings-segmented flex h-[30px] w-fit gap-0.5 rounded-md p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overview'}
            onClick={() => setView('overview')}
            className="settings-segmented-item rounded-[5px] px-3 text-[12px]"
          >
            {t('settings:usage.viewOverview')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'logs'}
            onClick={() => setView('logs')}
            className="settings-segmented-item inline-flex items-center gap-1.5 rounded-[5px] px-3 text-[12px]"
          >
            <span>{t('settings:usage.viewLogs')}</span>
            {total && total.calls > 0 ? (
              <span className="rounded bg-foreground/10 px-1.5 py-0 font-mono text-[10.5px] tabular-nums">
                {total.calls.toLocaleString()}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {view === 'logs' ? (
        <UsageLogsTable
          days={range}
          initialModel={logFilterModel}
          initialProject={logFilterProject}
          onOpenSession={openSession}
        />
      ) : (
        <>
          {error ? <p className="text-sm text-destructive">{t('settings:usage.failed')}</p> : null}
          {!data && loading ? <p className="text-sm text-muted-foreground">{t('settings:usage.loading')}</p> : null}

          {data && total ? (
            <>
              {/* 6-cell KPI matrix (standalone card container so .settings-card > * + * does not inject top borders) */}
              <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-base)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:bg-[var(--bg-1)] dark:shadow-none sm:grid-cols-3 lg:grid-cols-6">
                {/* 1. Cost */}
                <div className="border-b border-r border-border/60 px-4 py-3.5 lg:border-b-0">
                  <div className="text-[11px] text-muted-foreground">{t('settings:usage.cost')}</div>
                  <div className="mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums">
                    {formatCost(total.cost)}
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {calendarDays > 1
                      ? `${t('settings:usage.avgPerDay')} ${formatCost(total.cost / calendarDays)}`
                      : total.calls > 0
                        ? `${t('settings:usage.avgPerCall')} ${formatCost(total.cost / total.calls)}`
                        : '\u00a0'}
                  </div>
                </div>

                {/* 2. Tokens + stacked proportion bar */}
                <div className="border-b border-border/60 px-4 py-3.5 sm:border-r lg:border-b-0">
                  <div className="text-[11px] text-muted-foreground">{t('settings:usage.tokens')}</div>
                  <div className="mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums">
                    {formatTokens(totalTokensVal)}
                  </div>
                  {totalTokensVal > 0 ? (
                    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                      <span style={{ flexGrow: total.input, background: '#476885' }} title={`${t('settings:usage.input')}: ${formatTokens(total.input)}`} />
                      <span style={{ flexGrow: total.cacheRead, background: '#2e856e' }} title={`${t('settings:usage.cacheRead')}: ${formatTokens(total.cacheRead)}`} />
                      <span style={{ flexGrow: total.cacheWrite, background: '#b8762e' }} title={`${t('settings:usage.cacheWrite')}: ${formatTokens(total.cacheWrite)}`} />
                      <span style={{ flexGrow: total.output, background: '#8c5246' }} title={`${t('settings:usage.output')}: ${formatTokens(total.output)}`} />
                    </div>
                  ) : null}
                  <div className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">
                    {formatTokens(total.input)} in · {formatTokens(total.output)} out
                  </div>
                </div>

                {/* 3. Requests & Status */}
                <div className="border-b border-r border-border/60 px-4 py-3.5 sm:border-r-0 lg:border-b-0 lg:border-r">
                  <div className="text-[11px] text-muted-foreground">{t('settings:usage.calls')}</div>
                  <div className="mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums">
                    {total.calls.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                    {(total.errorCalls > 0 || total.abortedCalls > 0)
                      ? t('settings:usage.statusSummary', {
                          ok: total.successCalls,
                          err: total.errorCalls,
                          abort: total.abortedCalls,
                        })
                      : `${t('settings:usage.sessionsCount')} ${data.sessions} · ${t('settings:usage.activeDays')} ${data.activeDays}`}
                  </div>
                </div>

                {/* 4. Cache Hit & Write */}
                <div className="border-b border-border/60 px-4 py-3.5 sm:border-b-0 sm:border-r" title={t('settings:usage.cacheHitHint')}>
                  <div className="text-[11px] text-muted-foreground">{t('settings:usage.cacheHit')}</div>
                  <div className={cn('mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums', cacheHitTone(data.cacheHitRate))}>
                    {formatPct(data.cacheHitRate)}
                  </div>
                  <div className="mt-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                    {t('settings:usage.cacheRead')} {formatTokens(total.cacheRead)}
                    {total.cacheWrite > 0 ? ` · +${formatTokens(total.cacheWrite)}` : ''}
                  </div>
                </div>

                {/* 5. Throughput (TPS) */}
                <div className="border-r border-border/60 px-4 py-3.5">
                  <div className="text-[11px] text-muted-foreground">{t('settings:usage.tps')}</div>
                  <div className={cn('mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums', tpsTone(total.genTps ?? total.totalTps, total.genTps != null))}>
                    {(total.genTps ?? total.totalTps) != null ? `${formatTps(total.genTps ?? total.totalTps)}` : '—'}
                    {(total.genTps ?? total.totalTps) != null ? (
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">tok/s</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {total.genTps != null && total.totalTps != null
                      ? t('settings:usage.tpsTotal', { value: formatTps(total.totalTps) })
                      : total.totalTps != null
                        ? t('settings:usage.tpsE2E', { value: formatTps(total.totalTps) })
                        : '\u00a0'}
                  </div>
                </div>

                {/* 6. TTFT & Latency */}
                <div className="px-4 py-3.5">
                  <div className="text-[11px] text-muted-foreground">
                    {total.ttftCalls > 0 ? t('settings:usage.ttft') : t('settings:usage.latency')}
                  </div>
                  <div className={cn('mt-0.5 font-mono text-[19px] font-semibold tracking-tight tabular-nums', total.ttftCalls > 0 ? ttftTone(total.p50TtftMs) : 'text-foreground')}>
                    {total.ttftCalls > 0
                      ? formatDurationMs(total.p50TtftMs ?? total.avgTtftMs)
                      : formatDurationMs(total.p50DurationMs ?? total.avgDurationMs)}
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {total.ttftCalls > 0
                      ? `${t('settings:usage.p90', { value: formatDurationMs(total.p90TtftMs) })} · ${t('settings:usage.totalDuration')} ${formatDurationMs(total.p50DurationMs)}`
                      : total.avgDurationMs != null
                        ? t('settings:usage.avgDuration', { value: formatDurationMs(total.avgDurationMs) })
                        : '\u00a0'}
                  </div>
                </div>
              </div>

              {total.calls === 0 ? (
                <p className="text-[13px] text-muted-foreground">{t('settings:usage.empty')}</p>
              ) : (
                <>
                  {data.byDay.length > 1 ? (
                    <SettingsSection
                      title={t('settings:usage.dailyTrend')}
                      description={
                        peak && peak.cost > 0 ? `${t('settings:usage.peakDay')}: ${peak.day} (${formatCost(peak.cost)})` : undefined
                      }
                    >
                      <DayChart days={data.byDay} />
                    </SettingsSection>
                  ) : null}

                  {data.byDay.length >= 60 ? (
                    <SettingsSection
                      title={t('settings:usage.activity')}
                      description={
                        data.firstAt ? `${t('settings:usage.since')} ${new Date(data.firstAt).toISOString().slice(0, 10)}` : undefined
                      }
                      action={
                        <MetricToggle
                          value={heatMetric}
                          options={[
                            ['cost', t('settings:usage.cost')],
                            ['tokens', t('settings:usage.tokens')],
                          ]}
                          onChange={setHeatMetric}
                        />
                      }
                    >
                      <CalendarHeatmap days={data.byDay} metric={heatMetric} />
                    </SettingsSection>
                  ) : null}

                  <SettingsSection
                    title={t('settings:usage.byHour')}
                    action={
                      <MetricToggle
                        value={hourMetric}
                        options={[
                          ['calls', t('settings:usage.calls')],
                          ['cost', t('settings:usage.cost')],
                        ]}
                        onChange={setHourMetric}
                      />
                    }
                  >
                    <HourHeatmap heat={data.heat} metric={hourMetric} />
                  </SettingsSection>

                  <SettingsSection title={t('settings:usage.byModel')} description={t('settings:usage.modelPerfHint')}>
                    <ModelPerfTable models={data.byModel} maxCost={maxModel} onSelectModel={jumpToModelLogs} />
                  </SettingsSection>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <SettingsSection title={t('settings:usage.byProject')}>
                      {data.byProject.map((p) => (
                        <RankRow
                          key={p.project}
                          label={projectName(p.project)}
                          sub={p.project}
                          bucket={p}
                          max={maxProject}
                          onClick={() => jumpToProjectLogs(p.project)}
                        />
                      ))}
                    </SettingsSection>

                    <SettingsSection title={t('settings:usage.topSessions')}>
                      {data.topSessions.map((s) => (
                        <RankRow
                          key={s.sessionFile}
                          label={s.title || t('settings:usage.untitled')}
                          sub={`${projectName(s.project)} · ${t('settings:usage.callsCount', { count: s.calls })}`}
                          bucket={s}
                          max={maxSession}
                          onClick={() => openSession(s.sessionFile, s.project)}
                        />
                      ))}
                    </SettingsSection>
                  </div>
                </>
              )}
            </>
          ) : null}
        </>
      )}

      <p className="px-1 text-[11.5px] leading-[1.6] text-muted-foreground">{t('settings:usage.note')}</p>
    </div>
  )
}
