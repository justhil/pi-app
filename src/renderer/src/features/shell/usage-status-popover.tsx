import { useTranslation } from 'react-i18next'
import type { UsageSummary } from '@shared/usage-summary'
import { RefreshCw } from '@renderer/components/icons'
import { formatCost, formatTokens, tokensOf } from '@renderer/features/settings/usage-charts'

/** `provider/model` as recorded by the scan; older records may carry the model alone. */
function splitModel(id: string): { model: string; provider: string | null } {
  const cut = id.indexOf('/')
  return cut < 0 ? { model: id, provider: null } : { provider: id.slice(0, cut), model: id.slice(cut + 1) }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[11px] text-foreground-secondary">{label}</span>
      <span className="truncate text-sm tabular-nums">{value}</span>
    </div>
  )
}

/** Today's totals plus a per-model breakdown; the same numbers as Settings → Usage with range "Today". */
export function TodayUsageBody({ usage, failed, onRefresh }: { usage: UsageSummary | null; failed: boolean; onRefresh: () => void }) {
  const { t } = useTranslation()
  const cost = formatCost(usage?.total.cost ?? 0)
  const tokens = usage ? formatTokens(tokensOf(usage.total)) : '—'
  const cache = usage?.cacheHitRate == null ? '—' : `${Math.round(usage.cacheHitRate * 100)}%`
  const models = (usage?.byModel ?? []).filter((row) => row.calls > 0)
  const maxCost = Math.max(...models.map((row) => row.cost), 0)

  return (
    <>
      <div className="workbench-resource-summary">
        <div>
          <span className="workbench-row-detail">{t('common:statusBar.usageCost')}</span>
          <strong className="block text-xl font-medium tabular-nums">{cost}</strong>
          <span className="workbench-row-detail tabular-nums">{t('common:statusBar.usageTokensValue', { tokens })}</span>
        </div>
        <button type="button" className="workbench-icon" aria-label={t('common:refresh')} onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 px-4 pb-3">
        <Metric label={t('common:statusBar.usageReplies')} value={usage ? String(usage.total.calls) : '—'} />
        <Metric label={t('common:statusBar.usageCacheHits')} value={cache} />
        <Metric label={t('common:statusBar.usageSessions')} value={usage ? String(usage.sessions) : '—'} />
      </div>
      {failed && <p role="alert" className="workbench-error">{t('common:statusBar.usageFailed')}</p>}
      {!usage && !failed ? (
        <p role="status" className="workbench-empty">{t('common:loading')}</p>
      ) : models.length === 0 ? (
        <p className="workbench-empty">{t('common:statusBar.usageEmpty')}</p>
      ) : (
        <section className="workbench-group" aria-label={t('common:statusBar.usageByModel')}>
          <h3 className="workbench-group-heading">{t('common:statusBar.usageByModel')}<span>{models.length}</span></h3>
          {models.map((row) => {
            const { model, provider } = splitModel(row.model)
            return (
              <div key={row.model} className="workbench-resource-row">
                <div className="min-w-0 flex-1">
                  <div className="workbench-row-title truncate">{model}</div>
                  <div className="workbench-row-detail">
                    {provider ? `${provider} · ` : ''}{t('common:statusBar.usageTokensValue', { tokens: formatTokens(tokensOf(row)) })}
                  </div>
                  <div className="mt-1 h-[3px] rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-foreground/40" style={{ width: `${maxCost > 0 ? Math.max(2, (row.cost / maxCost) * 100) : 0}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="workbench-row-title">{formatCost(row.cost)}</div>
                  <div className="workbench-row-detail">{t('common:statusBar.usageCalls', { count: row.calls })}</div>
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
