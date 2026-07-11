import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  CircleDot,
  Wrench,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
import { formatTokens } from '@renderer/lib/format-tokens'
import {
  ContextDonutChart,
  ContextRoleLegend,
  buildContextRoleSlices,
} from '@renderer/features/run/context-donut'

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

type RunVisualStatus = 'idle' | 'running' | 'failed' | 'tool' | 'thinking'

function resolveVisualStatus(params: {
  status: string
  activeTool?: string | null
  thinkingLevel?: string | null
}): RunVisualStatus {
  if (params.status === 'failed') return 'failed'
  if (params.status === 'running' && params.activeTool) return 'tool'
  if (params.status === 'running') {
    if (params.thinkingLevel && params.thinkingLevel !== 'off') return 'thinking'
    return 'running'
  }
  return 'idle'
}

export function RunPanel() {
  const { t } = useTranslation()
  const runState = useUIStore((s) => s.runState)
  const model = runState.model
  const thinkingLevel = runState.thinkingLevel
  const [tick, setTick] = useState(0)
  const metrics = useComposerMetrics()

  useEffect(() => {
    if (runState.status !== 'running' || !runState.startTime) return
    const timer = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [runState.status, runState.startTime])

  void tick
  const elapsedLabel = (() => {
    if (runState.status === 'running' && runState.startTime) {
      return formatDuration(Date.now() - runState.startTime)
    }
    if (runState.lastRunDurationMs != null && runState.lastRunDurationMs > 0) {
      return `${formatDuration(runState.lastRunDurationMs)} · ${t('run:metrics.turn')}`
    }
    return '—'
  })()

  const isRunning = runState.status === 'running'
  const visualStatus = resolveVisualStatus({
    status: runState.status,
    activeTool: runState.activeTool,
    thinkingLevel,
  })
  const tokPerSec =
    metrics.tps != null && metrics.tps > 0 ? Math.round(metrics.tps / 4) : null

  const roleSlices = useMemo(
    () =>
      buildContextRoleSlices(
        metrics.contextPreview?.roleBreakdown,
        metrics.contextPreview?.estimatedChars ?? 0,
      ),
    [metrics.contextPreview],
  )

  const freeTokens =
    metrics.contextWindow != null && metrics.estContextTokens != null
      ? Math.max(0, metrics.contextWindow - metrics.estContextTokens)
      : null

  const roleLabels: Record<string, string> = {
    system: t('run:role.system'),
    user: t('run:role.user'),
    assistant: t('run:role.assistant'),
    tool: t('run:role.tool'),
    summary: t('run:role.summary'),
    other: t('run:role.other'),
  }

  const statusCopy: Record<
    RunVisualStatus,
    { title: string; icon: typeof Activity; accent: string; badge: string; pulse?: boolean }
  > = {
    idle: {
      title: t('run:status.idle'),
      icon: CircleDot,
      accent: 'text-foreground-secondary',
      badge: 'bg-[var(--bg-3)] text-foreground-secondary',
    },
    running: {
      title: t('run:status.running'),
      icon: Activity,
      accent: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      pulse: true,
    },
    tool: {
      title: t('run:status.toolRunning'),
      icon: Wrench,
      accent: 'text-sky-600 dark:text-sky-400',
      badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      pulse: true,
    },
    thinking: {
      title: t('run:status.thinking'),
      icon: Sparkles,
      accent: 'text-[var(--brand)]',
      badge: 'bg-[var(--brand)]/10 text-[var(--aou-7)] dark:text-[var(--aou-5)]',
      pulse: true,
    },
    failed: {
      title: t('run:status.failed'),
      icon: AlertTriangle,
      accent: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
    },
  }

  const statusVisual = statusCopy[visualStatus]
  const StatusIcon = statusVisual.icon

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {/* Status strip — design-forward, not a loud card */}
      <div className="relative border-b border-border/40 px-3 pb-3 pt-3">
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-[2px]',
            visualStatus === 'running' && 'bg-emerald-500/50',
            visualStatus === 'tool' && 'bg-sky-500/50',
            visualStatus === 'thinking' && 'bg-[var(--brand)]/45',
            visualStatus === 'failed' && 'bg-amber-500/40',
            visualStatus === 'idle' && 'bg-transparent',
          )}
        />
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--bg-2)]/80',
              statusVisual.accent,
            )}
          >
            <StatusIcon className={cn('h-3.5 w-3.5', statusVisual.pulse && 'animate-pulse')} />
            {isRunning && (
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full',
                  visualStatus === 'tool' ? 'bg-sky-500' : 'bg-emerald-500',
                )}
              >
                <span
                  className={cn(
                    'absolute inset-0 animate-ping rounded-full opacity-60',
                    visualStatus === 'tool' ? 'bg-sky-400' : 'bg-emerald-400',
                  )}
                />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium tracking-tight text-foreground">
                {statusVisual.title}
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                  statusVisual.badge,
                )}
              >
                {elapsedLabel}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-foreground-secondary">
              {model ? (
                <span className="truncate font-mono text-[11px] text-foreground/75" title={model}>
                  {model}
                </span>
              ) : (
                <span className="text-foreground-secondary/55">{t('run:noModel')}</span>
              )}
              {thinkingLevel && thinkingLevel !== 'off' && (
                <span className="text-foreground-secondary/60">
                  · {t('run:thinking', { level: thinkingLevel })}
                </span>
              )}
            </div>
            {isRunning && runState.activeTool && (
              <div className="mt-1.5 flex items-start gap-1.5 rounded-md px-1.5 py-1" style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}>
                <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-foreground-secondary/55" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-foreground/90">
                    {runState.activeTool}
                  </div>
                  {runState.activeToolStatus && (
                    <p className="mt-0.5 truncate text-[10px] text-foreground-secondary/70">
                      {runState.activeToolStatus}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Soft tool-error chip — muted amber, not destructive red banner */}
        {runState.errorCount > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-amber-500/[0.08] px-2 py-1 text-[11px] text-amber-800/90 dark:text-amber-200/85">
            <AlertTriangle className="h-3 w-3 shrink-0 opacity-70" />
            <span className="leading-snug">
              {t('run:tokenError', { count: runState.errorCount })}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">
        {/* Context donut */}
        <section>
          <div className="mb-1.5 text-[11px] font-medium text-foreground-secondary/70">
            {t('run:contextBreakdown')}
          </div>
          {metrics.contextPreview && metrics.contextPreview.estimatedChars > 0 ? (
            <div className="flex items-center gap-3">
              <ContextDonutChart
                slices={roleSlices}
                contextWindow={metrics.contextWindow}
                estimatedChars={metrics.contextPreview.estimatedChars}
                centerSub={
                  metrics.ctxPct != null
                    ? `${metrics.ctxPct.toFixed(0)}%`
                    : t('run:metrics.budget')
                }
              />
              <ContextRoleLegend
                slices={roleSlices}
                labels={roleLabels}
                freeLabel={t('run:role.free')}
                freeTokens={freeTokens}
              />
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-foreground-secondary/55">
              {t('run:contextEmpty')}
            </p>
          )}
          {metrics.contextWindow != null && metrics.estContextTokens != null && (
            <p className="mt-1.5 text-[10px] tabular-nums text-foreground-secondary/50">
              {t('run:contextWindow', {
                window: formatTokens(metrics.contextWindow),
                pct: metrics.ctxPct?.toFixed(1) ?? '0',
              })}
              {' · '}
              {formatTokens(metrics.estContextTokens)} tok
            </p>
          )}
        </section>

        <section className="rounded-md border border-border/35 p-2.5">
          <div className="mb-1 text-[11px] font-medium text-foreground-secondary/70">
            {t('run:realtimeMetrics')}
          </div>
          <MetricRow label={t('run:elapsed')} value={elapsedLabel} />
          <MetricRow
            label={t('run:genSpeed')}
            value={
              tokPerSec != null
                ? `${tokPerSec} tok/s`
                : isRunning
                  ? t('run:waitingOutput')
                  : '—'
            }
            sub={
              metrics.tps != null && metrics.tps > 0
                ? t('run:approxCharsPerSec', { count: Math.round(metrics.tps) })
                : undefined
            }
          />
          {metrics.cacheHitPct != null && runState.usage && runState.usage.cacheRead > 0 && (
            <MetricRow
              label={t('run:metrics.cache')}
              value={`${metrics.cacheHitPct.toFixed(0)}%`}
              sub={t('run:cacheRead', { value: formatTokens(runState.usage.cacheRead) })}
            />
          )}
        </section>

        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border/35 px-2.5 py-2">
            <div className="text-[10px] font-medium text-foreground-secondary/70">
              {t('run:toolCalls')}
            </div>
            <div className="mt-1 text-[16px] font-semibold tabular-nums text-foreground">
              {runState.toolCount}
            </div>
            {runState.errorCount > 0 && (
              <div className="text-[10px] text-amber-700/75 dark:text-amber-300/70">
                {t('run:errors', { count: runState.errorCount })}
              </div>
            )}
          </div>
          <div className="rounded-md border border-border/35 px-2.5 py-2">
            <div className="text-[10px] font-medium text-foreground-secondary/70">
              {t('run:messageCount')}
            </div>
            <div className="mt-1 text-[16px] font-semibold tabular-nums text-foreground">
              {metrics.contextPreview?.messageCount ?? '—'}
            </div>
          </div>
        </section>

        {runState.usage && (
          <section className="rounded-md border border-border/35 p-2.5">
            <div className="mb-1 text-[11px] font-medium text-foreground-secondary/70">
              Token
            </div>
            <div className="space-y-0.5 font-mono text-[12px]">
              <MetricRow label={t('run:input')} value={runState.usage.input.toLocaleString()} />
              <MetricRow label={t('run:output')} value={runState.usage.output.toLocaleString()} />
              <MetricRow
                label={t('run:cacheReadLabel')}
                value={runState.usage.cacheRead.toLocaleString()}
              />
              <MetricRow
                label={t('run:cacheWriteLabel')}
                value={runState.usage.cacheWrite.toLocaleString()}
              />
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border/30 pt-2">
              <span className="text-[12px] text-foreground-secondary">{t('run:cost')}</span>
              <span className="font-mono text-[13px] font-semibold tabular-nums">
                ${runState.usage.cost.toFixed(4)}
              </span>
            </div>
          </section>
        )}

        {!isRunning && !runState.usage && !metrics.contextPreview && (
          <p className="px-0.5 text-[11px] leading-relaxed text-foreground-secondary/55">
            {t('run:emptyHint')}
          </p>
        )}
      </div>
    </div>
  )
}
