import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { formatTokens } from '@renderer/lib/format-tokens'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

/** Footer: context, message count, TPS, cache, turn usage */
export function ComposerMetricsFooter({
  usage,
  isRunning,
  metrics,
}: {
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
  isRunning?: boolean
  metrics: Metrics
}) {
  const { t } = useTranslation()
  const tokPerSec =
    metrics.tps != null && metrics.tps > 0 ? Math.round(metrics.tps / 4) : null

  const hasContext =
    metrics.estContextTokens != null ||
    (metrics.contextPreview != null && metrics.contextPreview.messageCount > 0)

  if (!hasContext && !tokPerSec && !usage && !isRunning) return null

  const muted = 'text-[11px] text-foreground-secondary/55 tabular-nums leading-relaxed'
  const sep = <span className="mx-1.5 text-foreground-secondary/18">|</span>

  return (
    <div className={cn('mt-2 flex flex-wrap items-baseline gap-y-0.5 px-1', muted)}>
      {hasContext && (
        <span className="inline-flex flex-wrap items-baseline gap-x-1">
          {metrics.estContextTokens != null && (
            <span title={t('composer:contextHint')}>
              {t('composer:contextLabel')}{' '}
              <span className="text-foreground-secondary/55">
                {formatTokens(metrics.estContextTokens)}
                {metrics.contextWindow != null && (
                  <> / {formatTokens(metrics.contextWindow)}</>
                )}
                {metrics.ctxPct != null && <> ({metrics.ctxPct.toFixed(1)}%)</>}
              </span>
            </span>
          )}
          {metrics.contextPreview != null && metrics.contextPreview.messageCount > 0 && (
            <span className="text-foreground-secondary/38">
              {metrics.estContextTokens != null && ' · '}
              {t('composer:messages', { count: metrics.contextPreview.messageCount })}
            </span>
          )}
        </span>
      )}

      {tokPerSec != null && (
        <>
          {hasContext && sep}
          <span className="text-foreground-secondary/50">{tokPerSec} tok/s</span>
        </>
      )}

      {isRunning && !tokPerSec && (
        <>
          {(hasContext) && sep}
          <span className="text-green-600/70 dark:text-green-400/70">{t('composer:running')}</span>
        </>
      )}

      {usage && (usage.input > 0 || usage.output > 0) && (
        <>
          {(hasContext || tokPerSec || isRunning) && sep}
          <span>
            {t('composer:turnUsage', { in: formatTokens(usage.input), out: formatTokens(usage.output) })}
          </span>
        </>
      )}

      {metrics.cacheHitPct != null && usage && usage.cacheRead > 0 && (
        <>
          {sep}
          <span>
            {t('composer:cacheStats', { pct: metrics.cacheHitPct.toFixed(0), read: formatTokens(usage.cacheRead) })}
            {metrics.cacheWrite > 0 && t('composer:cacheWrite', { write: formatTokens(metrics.cacheWrite) })}
          </span>
        </>
      )}

      {usage && usage.cost > 0 && (
        <>
          {sep}
          <span>${usage.cost.toFixed(4)}</span>
        </>
      )}
    </div>
  )
}