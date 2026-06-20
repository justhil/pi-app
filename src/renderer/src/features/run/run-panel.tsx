import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useState } from 'react'
import { Coins, AlertCircle, Activity, Timer, Gauge, Database } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
import { formatTokens } from '@renderer/lib/format-tokens'

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[12px] text-foreground-secondary">{label}</span>
      <div className="text-right">
        <span className="text-[13px] font-semibold tabular-nums text-foreground">{value}</span>
        {sub && <div className="text-[10px] tabular-nums text-foreground-secondary/70">{sub}</div>}
      </div>
    </div>
  )
}

export function RunPanel() {
  const runState = useUIStore((s) => s.runState)
  const model = runState.model
  const thinkingLevel = runState.thinkingLevel
  const [tick, setTick] = useState(0)
  const metrics = useComposerMetrics()

  useEffect(() => {
    if (runState.status !== 'running' || !runState.startTime) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [runState.status, runState.startTime])

  void tick
  const elapsedLabel = (() => {
    if (runState.status === 'running' && runState.startTime) {
      return formatDuration(Date.now() - runState.startTime)
    }
    if (runState.lastRunDurationMs != null && runState.lastRunDurationMs > 0) {
      return `${formatDuration(runState.lastRunDurationMs)} · 上轮`
    }
    return '—'
  })()

  const isRunning = runState.status === 'running'
  const tokPerSec =
    metrics.tps != null && metrics.tps > 0 ? Math.round(metrics.tps / 4) : null

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 space-y-3">
      <div
        className={cn(
          'rounded-xl border p-3 transition-colors',
          isRunning
            ? 'border-green-500/25 bg-green-500/[0.06]'
            : runState.status === 'failed'
              ? 'border-destructive/25 bg-destructive/[0.06]'
              : 'border-border/50 bg-[var(--bg-2)]/40',
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg',
              isRunning ? 'bg-green-500/15' : 'bg-[var(--bg-3)]',
            )}
          >
            <Activity className={cn('h-4 w-4', isRunning ? 'text-green-600 animate-pulse' : 'text-foreground-secondary')} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold leading-snug text-foreground">
              {isRunning ? '运行中' : runState.status === 'failed' ? '失败' : '空闲'}
            </div>
            <div className="text-[12px] leading-relaxed text-foreground-secondary">
              {model && <span className="font-mono text-[11px]">{model}</span>}
              {thinkingLevel && thinkingLevel !== 'off' && (
                <span className="ml-2 text-foreground-secondary/80">思考 {thinkingLevel}</span>
              )}
            </div>
          </div>
        </div>
        {isRunning && runState.activeTool && (
          <div className="mt-2.5 rounded-lg bg-[var(--bg-base)]/60 px-2.5 py-2 text-[12px] leading-relaxed">
            <span className="text-foreground-secondary">工具 </span>
            <span className="font-mono font-medium text-foreground">{runState.activeTool}</span>
            {runState.activeToolStatus && (
              <p className="mt-1 truncate text-[11px] text-sky-700/90 dark:text-sky-400/90">{runState.activeToolStatus}</p>
            )}
          </div>
        )}
      </div>

      <section className="rounded-xl border border-border/50 bg-[var(--bg-2)]/30 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary/80">
          <Gauge className="h-3.5 w-3.5" />
          实时指标
        </div>
        <MetricRow label="耗时" value={elapsedLabel} />
        <MetricRow
          label="生成速度"
          value={tokPerSec != null ? `${tokPerSec} tok/s` : isRunning ? '等待输出…' : '—'}
          sub={metrics.tps != null && metrics.tps > 0 ? `约 ${Math.round(metrics.tps)} 字/s` : undefined}
        />
        <MetricRow
          label="上下文占用"
          value={
            metrics.estContextTokens != null
              ? `${formatTokens(metrics.estContextTokens)} tok`
              : '—'
          }
          sub={
            metrics.contextWindow != null && metrics.ctxPct != null
              ? `窗口 ${formatTokens(metrics.contextWindow)} · ${metrics.ctxPct.toFixed(1)}%`
              : metrics.contextPreview
                ? `${metrics.contextPreview.messageCount} 条消息`
                : undefined
          }
        />
        {metrics.ctxPct != null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-3)]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                metrics.ctxPct > 85 ? 'bg-amber-500' : metrics.ctxPct > 60 ? 'bg-brand' : 'bg-green-500/80',
              )}
              style={{ width: `${Math.min(100, metrics.ctxPct)}%` }}
            />
          </div>
        )}
        {metrics.cacheHitPct != null && runState.usage && runState.usage.cacheRead > 0 && (
          <MetricRow
            label="缓存命中"
            value={`${metrics.cacheHitPct.toFixed(0)}%`}
            sub={`读 ${formatTokens(runState.usage.cacheRead)}`}
          />
        )}
      </section>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/50 bg-[var(--bg-2)]/40 p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium text-foreground-secondary/80">
            <Timer className="h-3 w-3" />
            工具调用
          </div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">{runState.toolCount}</div>
          {runState.errorCount > 0 && (
            <div className="text-[11px] text-destructive">{runState.errorCount} 错误</div>
          )}
        </div>
        <div className="rounded-lg border border-border/50 bg-[var(--bg-2)]/40 p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium text-foreground-secondary/80">
            <Database className="h-3 w-3" />
            消息条数
          </div>
          <div className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
            {metrics.contextPreview?.messageCount ?? '—'}
          </div>
        </div>
      </section>

      {runState.usage && (
        <section className="rounded-xl border border-border/50 bg-[var(--bg-2)]/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary/80">
            <Coins className="h-3.5 w-3.5" />
            最近一轮 Token
          </div>
          <div className="space-y-0.5 font-mono text-[12px]">
            <MetricRow label="输入" value={runState.usage.input.toLocaleString()} />
            <MetricRow label="输出" value={runState.usage.output.toLocaleString()} />
            <MetricRow label="缓存读" value={runState.usage.cacheRead.toLocaleString()} />
            <MetricRow label="缓存写" value={runState.usage.cacheWrite.toLocaleString()} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
            <span className="text-[12px] text-foreground-secondary">费用</span>
            <span className="font-mono text-[14px] font-semibold tabular-nums">${runState.usage.cost.toFixed(4)}</span>
          </div>
        </section>
      )}

      {runState.errorCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="text-[13px] leading-snug text-destructive">{runState.errorCount} 个工具错误</span>
        </div>
      )}

      {!isRunning && !runState.usage && (
        <p className="px-1 text-[12px] leading-relaxed text-foreground-secondary/70">
          发送消息后此处显示本轮 TPS、上下文占用与 Token 用量。
        </p>
      )}
    </div>
  )
}