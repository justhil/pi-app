import { cn } from '@renderer/lib/utils'
import { formatTokens } from '@renderer/lib/format-tokens'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

/** 输入框下方：上下文、消息数、TPS、缓存、本轮用量 */
export function ComposerMetricsFooter({
  usage,
  isRunning,
  metrics,
}: {
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
  isRunning?: boolean
  metrics: Metrics
}) {
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
            <span title="会话上下文估算">
              上下文{' '}
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
              {metrics.contextPreview.messageCount} 条消息
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
          <span className="text-green-600/70 dark:text-green-400/70">运行中</span>
        </>
      )}

      {usage && (usage.input > 0 || usage.output > 0) && (
        <>
          {(hasContext || tokPerSec || isRunning) && sep}
          <span>
            本轮 in {formatTokens(usage.input)} · out {formatTokens(usage.output)}
          </span>
        </>
      )}

      {metrics.cacheHitPct != null && usage && usage.cacheRead > 0 && (
        <>
          {sep}
          <span>
            缓存 {metrics.cacheHitPct.toFixed(0)}% · 读 {formatTokens(usage.cacheRead)}
            {metrics.cacheWrite > 0 && <> · 写 {formatTokens(metrics.cacheWrite)}</>}
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