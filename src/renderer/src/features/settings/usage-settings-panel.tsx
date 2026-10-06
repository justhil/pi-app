import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingsSection } from '@renderer/features/settings/settings-page-shared'

type Range = 1 | 7 | 30 | 90

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

const tokensOf = (b: UsageBucket) => b.input + b.output + b.cacheRead + b.cacheWrite
const projectName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** Stacked bars per day: input / cache read / cache write / output, height = total tokens. */
function DayChart({ days }: { days: UsageSummary['byDay'] }) {
  const { t } = useTranslation()
  const max = Math.max(1, ...days.map(tokensOf))
  const parts: { key: keyof UsageBucket; color: string; label: string }[] = [
    { key: 'input', color: 'var(--uib-c1, #4c6ef5)', label: t('settings:usage.input') },
    { key: 'cacheRead', color: 'var(--uib-c3, #12b886)', label: t('settings:usage.cacheRead') },
    { key: 'cacheWrite', color: 'var(--uib-c4, #fab005)', label: t('settings:usage.cacheWrite') },
    { key: 'output', color: 'var(--uib-c2, #e64980)', label: t('settings:usage.output') },
  ]
  const [hover, setHover] = useState<number | null>(null)
  const h = hover !== null ? days[hover] : null
  return (
    <div className="settings-row flex-col !items-stretch gap-2">
      <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
        <span className="ml-auto tabular-nums">{h ? `${h.day} · ${formatTokens(tokensOf(h))} · ${formatCost(h.cost)}` : ''}</span>
      </div>
      <div className="flex h-36 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => {
          const total = tokensOf(d)
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} title={`${d.day}  ${formatTokens(total)}  ${formatCost(d.cost)}`}>
              <div className={cn('flex w-full flex-col-reverse overflow-hidden rounded-[3px]', hover === i && 'opacity-80')} style={{ height: `${(total / max) * 100}%`, minHeight: total ? 2 : 0 }}>
                {parts.map((p) => (d[p.key] ? <div key={p.key} style={{ height: `${((d[p.key] as number) / total) * 100}%`, background: p.color }} /> : null))}
              </div>
            </div>
          )
        })}
      </div>
      {days.length > 1 ? (
        <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{days[0].day.slice(5)}</span>
          <span>{days[days.length - 1].day.slice(5)}</span>
        </div>
      ) : null}
    </div>
  )
}

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

/**
 * Settings → Usage: tokens and cost of every session on this machine (pi's per-reply `usage`),
 * by day, model, project and session. Scanned in the preview process, re-reading only changed files.
 */
export function UsageSettingsPanel() {
  const { t } = useTranslation()
  const [range, setRange] = useState<Range>(7)
  const [data, setData] = useState<UsageSummary | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

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
  const ranges: { v: Range; l: string }[] = [
    { v: 1, l: t('settings:usage.today') },
    { v: 7, l: t('settings:usage.days', { count: 7 }) },
    { v: 30, l: t('settings:usage.days', { count: 30 }) },
    { v: 90, l: t('settings:usage.days', { count: 90 }) },
  ]
  const total = data?.total

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

      {total ? (
        <>
          <SettingsSection title={t('settings:usage.overview')}>
            <div className={cn('settings-row', loading && 'opacity-60')}>
              <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { l: t('settings:usage.cost'), v: formatCost(total.cost) },
                { l: t('settings:usage.tokens'), v: formatTokens(tokensOf(total)) },
                { l: t('settings:usage.calls'), v: String(total.calls) },
                { l: t('settings:usage.cacheHit'), v: data.cacheHitRate === null ? '—' : `${Math.round(data.cacheHitRate * 100)}%` },
              ].map((x) => (
                <div key={x.l} className="flex flex-col gap-0.5">
                  <span className="text-[11.5px] text-muted-foreground">{x.l}</span>
                  <span className="text-[18px] tabular-nums text-foreground">{x.v}</span>
                </div>
              ))}
              </div>
            </div>
            <div className="settings-row">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
                <span>{t('settings:usage.input')} {formatTokens(total.input)}</span>
                <span>{t('settings:usage.output')} {formatTokens(total.output)}</span>
                <span>{t('settings:usage.cacheRead')} {formatTokens(total.cacheRead)}</span>
                <span>{t('settings:usage.cacheWrite')} {formatTokens(total.cacheWrite)}</span>
              </div>
            </div>
            {range > 1 ? <DayChart days={data.byDay} /> : null}
          </SettingsSection>

          {total.calls === 0 ? (
            <p className="text-sm text-muted-foreground">{t('settings:usage.empty')}</p>
          ) : (
            <>
              <SettingsSection title={t('settings:usage.byModel')}>
                {data.byModel.map((m) => (
                  <RankRow key={m.model} label={m.model} sub={t('settings:usage.callsCount', { count: m.calls })} bucket={m} max={maxModel} />
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
                    sub={projectName(s.project)}
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
