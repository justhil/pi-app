import { formatTokens } from '@renderer/lib/format-tokens'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

/** 输入框内工具栏：加号右侧 — 上下文占用、TPS */
export function ComposerMetricsInline({ metrics, isRunning }: { metrics: Metrics; isRunning?: boolean }) {
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
        <span className="truncate" title="会话上下文估算">
          上下文{' '}
          <span className="text-foreground-secondary/62">
            {formatTokens(metrics.estContextTokens ?? 0)}
            {metrics.contextWindow != null && <> / {formatTokens(metrics.contextWindow)}</>}
            {metrics.ctxPct != null && <> ({metrics.ctxPct.toFixed(1)}%)</>}
          </span>
        </span>
      )}
      {tpsLabel && (
        <span className="shrink-0 text-foreground-secondary/55" title="输出速率">
          {tpsLabel}
        </span>
      )}
    </div>
  )
}