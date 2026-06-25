import { useTranslation } from 'react-i18next'
import { formatTokens } from '@renderer/lib/format-tokens'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

/** Inline toolbar: context usage, TPS */
export function ComposerMetricsInline({ metrics, isRunning }: { metrics: Metrics; isRunning?: boolean }) {
  const { t } = useTranslation()
  const showCtx = metrics.contextWindow != null || metrics.estContextTokens != null

  const tpsLabel =
    metrics.tps != null && metrics.tps > 0
      ? `${Math.round(metrics.tps)} tps`
      : isRunning
        ? '…'
        : null

  if (!showCtx && !tpsLabel) return null

  return (
    <div className="composer-metrics-inline flex min-w-0 shrink items-center gap-2 text-[10px] tabular-nums leading-none text-foreground-secondary/50">
      {showCtx && (
        <span className="truncate" title={t('composer:contextHint')}>
          {t('composer:contextLabel')}{' '}
          <span className="text-foreground-secondary/62">
            {formatTokens(metrics.estContextTokens ?? 0)}
            {metrics.contextWindow != null && <> / {formatTokens(metrics.contextWindow)}</>}
            {metrics.ctxPct != null && <> ({metrics.ctxPct.toFixed(1)}%)</>}
          </span>
        </span>
      )}
      {tpsLabel && (
        <span className="shrink-0 text-foreground-secondary/55" title={t('composer:tpsHint')}>
          {tpsLabel}
        </span>
      )}
    </div>
  )
}