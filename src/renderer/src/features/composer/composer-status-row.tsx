import { cn } from '@renderer/lib/utils'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** 输入框内上方：模型 / 上下文 / TPS / 缓存 / 本轮用量 */
export function ComposerStatusRow({
  model,
  thinkingLevel,
  usage,
  isRunning,
  modelPickerOpen,
  thinkingPickerOpen,
  onModelClick,
  onThinkingClick,
  metrics,
}: {
  model?: string
  thinkingLevel?: string
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
  isRunning?: boolean
  modelPickerOpen?: boolean
  thinkingPickerOpen?: boolean
  onModelClick: () => void
  onThinkingClick: () => void
  metrics: Metrics
}) {
  const linkCls = cn(
    'max-w-[min(220px,45vw)] truncate rounded-sm px-0.5 transition-colors duration-200',
    'text-foreground-secondary/50 hover:text-foreground-secondary/88',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/30',
  )

  const muted = 'text-foreground-secondary/42 tabular-nums'
  const sep = <span className="select-none text-foreground-secondary/22">·</span>

  const tokPerSec =
    metrics.tps != null && metrics.tps > 0 ? Math.round(metrics.tps / 4) : null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-[16px] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight">
        <button
          type="button"
          onClick={onModelClick}
          title="切换模型"
          className={cn(linkCls, modelPickerOpen && 'text-foreground-secondary/82')}
        >
          {model || '未选择模型'}
        </button>
        {sep}
        <button
          type="button"
          onClick={onThinkingClick}
          title="切换 thinking 等级"
          className={cn(linkCls, 'max-w-[140px]', thinkingPickerOpen && 'text-foreground-secondary/82')}
        >
          thinking {(thinkingLevel || 'off').toLowerCase()}
        </button>
        {isRunning && (
          <>
            {sep}
            <span className="text-[10px] text-green-600/75 dark:text-green-400/75">运行中</span>
          </>
        )}
      </div>

      <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-tight', muted)}>
        {metrics.estContextTokens != null && (
          <span title="会话上下文估算（字符÷4）；右栏 Context 可刷新详情">
            上下文 {formatTokens(metrics.estContextTokens)}
            {metrics.contextWindow != null && (
              <> / {formatTokens(metrics.contextWindow)}</>
            )}
            {metrics.ctxPct != null && (
              <span className="text-foreground-secondary/35"> ({metrics.ctxPct.toFixed(1)}%)</span>
            )}
          </span>
        )}
        {metrics.contextPreview != null && metrics.contextPreview.messageCount > 0 && (
          <>
            {metrics.estContextTokens != null && sep}
            <span>{metrics.contextPreview.messageCount} 条消息</span>
          </>
        )}
        {tokPerSec != null && (
          <>
            {(metrics.estContextTokens != null || metrics.contextPreview) && sep}
            <span title="流式输出估算 tok/s（字符速率÷4）" className="text-foreground-secondary/55">
              {tokPerSec} tok/s
            </span>
          </>
        )}
        {usage && (usage.input > 0 || usage.output > 0) && (
          <>
            {sep}
            <span title="最近一轮 turn 用量">
              本轮 in {formatTokens(usage.input)} · out {formatTokens(usage.output)}
            </span>
          </>
        )}
        {metrics.cacheHitPct != null && usage && usage.cacheRead > 0 && (
          <>
            {sep}
            <span title="cacheRead / (input + cacheRead)">
              缓存命中 {metrics.cacheHitPct.toFixed(0)}%
            </span>
            <span className="text-foreground-secondary/32">
              读 {formatTokens(usage.cacheRead)}
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
    </div>
  )
}