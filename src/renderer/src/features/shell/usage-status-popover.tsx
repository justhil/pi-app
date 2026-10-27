import { useTranslation } from 'react-i18next'
import type { UsageBucket, UsageSummary } from '@shared/usage-summary'
import { RefreshCw } from '@renderer/components/icons'
import { formatCost, formatTokens, tokensOf } from '@renderer/features/settings/usage-charts'

/** `provider/model` as recorded by the scan; older records may carry the model alone. */
function splitModel(id: string): { model: string; provider: string | null } {
  const cut = id.indexOf('/')
  return cut < 0 ? { model: id, provider: null } : { provider: id.slice(0, cut), model: id.slice(cut + 1) }
}

/** Cycled per model: the dot in the list matches its segment in the composition bar. */
const MODEL_COLORS = ['#5b6fd8', '#14a085', '#d98a2b', '#9b5de5', '#e2568a', '#3f8fb0', '#8a8f98']

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[11px] text-foreground-secondary">{label}</span>
      <span className="truncate text-sm tabular-nums">{value}</span>
      {sub ? <span className="truncate text-[11px] tabular-nums text-foreground-secondary">{sub}</span> : null}
    </div>
  )
}

/** Cost of the last seven days, today filled in — the direction a single number cannot show. */
function WeekStrip({ days }: { days: UsageSummary['byDay'] }) {
  const { i18n } = useTranslation()
  const week = days.slice(-7)
  const max = Math.max(...week.map((d) => d.cost), 0)
  const label = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString(i18n.language, { weekday: 'narrow' })
  return (
    <div className="flex items-end gap-1 px-4 pb-2" aria-hidden>
      {week.map((day, index) => {
        const today = index === week.length - 1
        const height = max > 0 ? Math.max(2, (day.cost / max) * 20) : 2
        return (
          <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${day.day} · ${formatCost(day.cost)} · ${formatTokens(tokensOf(day))} tokens`}>
            <span className={today ? 'w-full rounded-sm bg-foreground/70' : 'w-full rounded-sm bg-foreground/20'} style={{ height }} />
            <span className={today ? 'text-[10px] text-foreground' : 'text-[10px] text-foreground-secondary'}>{label(day.day)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** One bar split by cost, so the segments add up to the day instead of to the biggest model. */
function ModelMix({ rows, colors }: { rows: (UsageBucket & { model: string })[]; colors: string[] }) {
  const { t } = useTranslation()
  const total = rows.reduce((sum, row) => sum + row.cost, 0)
  return (
    <div
      className="mx-4 mb-2 flex h-1.5 overflow-hidden rounded-full bg-foreground/10"
      role="img"
      aria-label={rows.map((row, index) => `${splitModel(row.model).model} ${Math.round(share(row.cost, total) * 100)}%`).join(', ')}
    >
      {rows.map((row, index) => (
        <span key={row.model} style={{ width: `${share(row.cost, total) * 100}%`, backgroundColor: colors[index % colors.length] }} title={t('common:statusBar.usageModelShare', { model: splitModel(row.model).model, pct: Math.round(share(row.cost, total) * 100) })} />
      ))}
    </div>
  )
}

/** Today's totals, yesterday for context, the week, and the cost split by model. */
export function TodayUsageBody({ usage, history, failed, onRefresh }: { usage: UsageSummary | null; history: UsageSummary | null; failed: boolean; onRefresh: () => void }) {
  const { t } = useTranslation()
  const total = usage?.total
  const tokens = total ? formatTokens(tokensOf(total)) : '—'
  const cached = usage?.cacheHitRate == null ? null : Math.round(usage.cacheHitRate * 100)

  const week = history?.byDay ?? []
  const yesterday = week.length >= 2 ? week[week.length - 2] : null
  const delta = total && yesterday && yesterday.cost > 0 ? (total.cost - yesterday.cost) / yesterday.cost : null
  const models = (usage?.byModel ?? []).filter((row) => row.calls > 0).slice(0, MODEL_COLORS.length)
  const modelCost = models.reduce((sum, row) => sum + row.cost, 0)

  return (
    <>
      <div className="workbench-resource-summary">
        <div>
          <span className="workbench-row-detail">{t('common:statusBar.usageCost')}</span>
          <strong className="block text-xl font-medium tabular-nums">{formatCost(total?.cost ?? 0)}</strong>
          <span className="workbench-row-detail tabular-nums">
            {t('common:statusBar.usageTokensValue', { tokens })}
            {cached != null ? ` · ${t('common:statusBar.usageCached', { pct: cached })}` : null}
          </span>
        </div>
        <button type="button" className="workbench-icon" aria-label={t('common:refresh')} onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 pb-3">
        <Metric label={t('common:statusBar.usageRequests')} value={total ? String(total.calls) : '—'} />
        <Metric label={t('common:statusBar.usageSessions')} value={usage ? String(usage.sessions) : '—'} />
        <Metric
          label={t('common:statusBar.usageYesterday')}
          value={yesterday ? formatCost(yesterday.cost) : '—'}
          sub={delta == null ? undefined : `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100))}%`}
        />
      </div>
      {week.length > 1 ? <WeekStrip days={week} /> : null}
      {failed && <p role="alert" className="workbench-error">{t('common:statusBar.usageFailed')}</p>}
      {!usage && !failed ? (
        <p role="status" className="workbench-empty">{t('common:loading')}</p>
      ) : models.length === 0 ? (
        <p className="workbench-empty">{t('common:statusBar.usageEmpty')}</p>
      ) : (
        <section className="workbench-group" aria-label={t('common:statusBar.usageByModel')}>
          <h3 className="workbench-group-heading">{t('common:statusBar.usageByModel')}<span>{models.length}</span></h3>
          <ModelMix rows={models} colors={MODEL_COLORS} />
          {models.map((row, index) => {
            const { model, provider } = splitModel(row.model)
            const pct = Math.round(share(row.cost, modelCost) * 100)
            return (
              <div key={row.model} className="workbench-resource-row">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length] }} />
                  <div className="min-w-0">
                    <div className="workbench-row-title truncate">{model}</div>
                    <div className="workbench-row-detail">
                      {provider ? `${provider} · ` : ''}{formatTokens(tokensOf(row))} tokens · {t('common:statusBar.usageCalls', { count: row.calls })}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="workbench-row-title">{formatCost(row.cost)}</div>
                  <div className="workbench-row-detail">{pct}%</div>
                </div>
              </div>
            )
          })}
        </section>
      )}
      <p className="px-4 pb-3 pt-1 text-xs leading-relaxed text-foreground-secondary">{t('common:statusBar.usageHint')}</p>
    </>
  )
}
