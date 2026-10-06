import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { CalendarHeatmap, DayChart, formatCost, formatTokens, HourHeatmap, tokensOf } from './usage-charts'

/** Days back from today; 0 = all time. */
type Range = 1 | 7 | 30 | 90 | 365 | 0

const projectName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

function RankRow({ label, sub, bucket, max, onClick }: { label: string; sub?: string; bucket: UsageBucket; max: number; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('settings-row relative w-full text-left', onClick && 'hover:bg-accent/40')}>
      <div className="flex w-full items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-foreground">{label}</div>
          {sub ? <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div> : null}
          <div className="mt-1 h-[3px] rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground/40" style={{ width: `${Math.max(2, (bucket.cost > 0 ? bucket.cost / max : 0) * 100)}%` }} />
          </div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="text-[13px] text-foreground">{formatCost(bucket.cost)}</div>
          <div className="text-[11.5px] text-muted-foreground">{formatTokens(tokensOf(bucket))}</div>
        </div>
      </div>
    </Tag>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={hint}>
      <span className="truncate text-[11.5px] text-muted-foreground">{label}</span>
      <span className="truncate text-[18px] tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 text-[12px]">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="settings-segmented flex h-[24px] gap-0.5 rounded-md p-0.5">
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className="settings-segmented-item rounded-[4px] px-2 text-[11.5px]">
          {o.l}
        </button>
      ))}
    </div>
  )
}

/**
 * Settings → Usage: tokens and cost of every pi session on this machine (desktop and CLI share the
 * session files), by day, hour, model, project and session. Scanned in the preview process, re-reading
 * only changed files; replies copied into forks count once.
 */
export function UsageSettingsPanel() {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>(7)
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
  const peak = useMemo(() => (data?.byDay ?? []).reduce<UsageSummary['byDay'][number] | null>((best, d) => (!best || d.cost > best.cost ? d : best), null), [data])
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

  const openSession = (sessionFile: string, project: string) => {
    window.dispatchEvent(new CustomEvent('pi-desktop:open-session', { detail: { sessionFile, workspaceId: project } }))
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeader title={t('settings:usage.title')} description={t('settings:usage.description')} />
      <div role="radiogroup" aria-label={t('settings:usage.range')} className="settings-segmented flex h-[30px] w-fit gap-0.5 rounded-md p-0.5">
        {ranges.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={range === o.v} onClick={() => setRange(o.v)} className="settings-segmented-item rounded-[5px] px-3 text-[12px]">
            {o.l}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{t('settings:usage.failed')}</p> : null}
      {!data && loading ? <p className="text-sm text-muted-foreground">{t('settings:usage.loading')}</p> : null}

      {total && data ? (
        <>
          <SettingsSection title={t('settings:usage.overview')}>
            <div className={cn('settings-row', loading && 'opacity-60')}>
              <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label={t('settings:usage.cost')} value={formatCost(total.cost)} />
                <Stat label={t('settings:usage.tokens')} value={formatTokens(tokensOf(total))} />
                <Stat label={t('settings:usage.calls')} value={String(total.calls)} />
                <Stat label={t('settings:usage.cacheHit')} value={data.cacheHitRate === null ? '—' : `${Math.round(data.cacheHitRate * 100)}%`} hint={t('settings:usage.cacheHitHint')} />
              </div>
            </div>
            <div className={cn('settings-row', loading && 'opacity-60')}>
              <div className="grid w-full grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                <Small label={t('settings:usage.input')} value={formatTokens(total.input)} />
                <Small label={t('settings:usage.avgPerDay')} value={formatCost(total.cost / Math.max(1, calendarDays))} />
                <Small label={t('settings:usage.output')} value={total.reasoning ? `${formatTokens(total.output)} (${t('settings:usage.reasoning')} ${formatTokens(total.reasoning)})` : formatTokens(total.output)} />
                <Small label={t('settings:usage.avgPerCall')} value={total.calls ? `${formatCost(total.cost / total.calls)} · ${formatTokens(tokensOf(total) / total.calls)}` : '—'} />
                <Small label={t('settings:usage.cacheRead')} value={formatTokens(total.cacheRead)} />
                <Small label={t('settings:usage.activeDays')} value={`${data.activeDays} / ${calendarDays}`} />
                <Small label={t('settings:usage.cacheWrite')} value={formatTokens(total.cacheWrite)} />
                <Small label={t('settings:usage.peakDay')} value={peak && peak.cost > 0 ? `${peak.day} · ${formatCost(peak.cost)}` : '—'} />
                <Small label={t('settings:usage.sessionsCount')} value={String(data.sessions)} />
                <Small label={t('settings:usage.since')} value={data.firstAt ? new Date(data.firstAt).toLocaleDateString() : '—'} />
              </div>
            </div>
            {range !== 1 ? <DayChart days={data.byDay} /> : null}
          </SettingsSection>

          {total.calls === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings:usage.empty')}</p>
          ) : (
            <>
              <SettingsSection
                title={t('settings:usage.activity')}
                action={
                  <Segmented value={heatMetric} label={t('settings:usage.metric')} onChange={setHeatMetric} options={[{ v: 'cost', l: t('settings:usage.cost') }, { v: 'tokens', l: t('settings:usage.tokens') }]} />
                }
              >
                {calendarDays >= 14 ? (
                  <div className="settings-row">
                    <CalendarHeatmap days={data.byDay} metric={heatMetric} />
                  </div>
                ) : null}
                <div className="settings-row flex-col !items-stretch gap-2">
                  <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>{t('settings:usage.byHour')}</span>
                    <Segmented value={hourMetric} label={t('settings:usage.metric')} onChange={setHourMetric} options={[{ v: 'calls', l: t('settings:usage.calls') }, { v: 'cost', l: t('settings:usage.cost') }]} />
                  </div>
                  <HourHeatmap heat={data.heat} metric={hourMetric} />
                </div>
              </SettingsSection>
              <SettingsSection title={t('settings:usage.byModel')}>
                {data.byModel.map((m) => (
                  <RankRow
                    key={m.model}
                    label={m.model}
                    sub={`${t('settings:usage.callsCount', { count: m.calls })} · ${total.cost > 0 ? Math.round((m.cost / total.cost) * 100) : 0}%`}
                    bucket={m}
                    max={maxModel}
                  />
                ))}
              </SettingsSection>
              <SettingsSection title={t('settings:usage.byProject')}>
                {data.byProject.map((p) => (
                  <RankRow key={p.project} label={projectName(p.project)} sub={p.project} bucket={p} max={maxProject} />
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
                    onClick={s.project ? () => openSession(s.sessionFile, s.project) : undefined}
                  />
                ))}
              </SettingsSection>
            </>
          )}
          <p className="text-[11.5px] text-muted-foreground">{t('settings:usage.note')}</p>
        </>
      ) : null}
    </div>
  )
}
