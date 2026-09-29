import { useUIStore } from '@renderer/stores/ui-store'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Wrench,
  AlertTriangle,
} from '@renderer/components/icons'
import { useComposerMetrics } from '@renderer/features/composer/use-composer-metrics'
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

  const statusTitle: Record<RunVisualStatus, string> = {
    idle: t('run:status.idle'),
    running: t('run:status.running'),
    tool: t('run:status.toolRunning'),
    thinking: t('run:status.thinking'),
    failed: t('run:status.failed'),
  }
  const modelSlash = model ? model.indexOf('/') : -1
  const modelProvider = model && modelSlash > 0 ? model.slice(0, modelSlash) : ''
  const modelName = model && modelSlash > 0 ? model.slice(modelSlash + 1) : model
  const hasContext = !!metrics.contextPreview && metrics.contextPreview.estimatedChars > 0

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      {/* Status: dot + label, elapsed as quiet text, model on its own line in the UI font. */}
      <section className="panel-section">
        <div className="flex items-center gap-2">
          <span className="panel-status-dot" data-status={visualStatus} aria-hidden />
          <span className="text-[13px] font-medium text-foreground">{statusTitle[visualStatus]}</span>
          {elapsedLabel !== '—' ? (
            <span className="text-[11px] tabular-nums text-foreground-secondary">{elapsedLabel}</span>
          ) : null}
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px]">
          {model ? (
            <span className="min-w-0 truncate" title={model}>
              {modelProvider ? <span className="text-foreground-secondary">{modelProvider}/</span> : null}
              <span className="text-foreground">{modelName}</span>
            </span>
          ) : (
            <span className="text-foreground-secondary">{t('run:noModel')}</span>
          )}
          {thinkingLevel && thinkingLevel !== 'off' ? (
            <span className="panel-tag">{t('run:thinking', { level: thinkingLevel })}</span>
          ) : null}
        </div>
        {isRunning && runState.activeTool && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5" style={{ background: 'color-mix(in srgb, var(--bg-2) 55%, transparent)' }}>
            <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-foreground-secondary/70" />
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-foreground/90">{runState.activeTool}</div>
              {runState.activeToolStatus && (
                <p className="mt-0.5 truncate text-[11px] text-foreground-secondary">{runState.activeToolStatus}</p>
              )}
            </div>
          </div>
        )}
        {/* Soft tool-error chip — muted amber, not destructive red banner */}
        {runState.errorCount > 0 && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-500/[0.08] px-2 py-1 text-[11px] text-amber-800/90 dark:text-amber-200/85">
            <AlertTriangle className="h-3 w-3 shrink-0 opacity-70" />
            <span className="leading-snug">{t('run:tokenError', { count: runState.errorCount })}</span>
          </div>
        )}
      </section>

      <section className="panel-section">
        <h3 className="panel-section-title">{t('run:contextBreakdown')}</h3>
        {hasContext ? (
          <div className="flex items-center gap-4">
            <ContextDonutChart
              slices={roleSlices}
              contextWindow={metrics.contextWindow}
              estimatedChars={metrics.contextPreview!.estimatedChars}
              centerSub={metrics.ctxPct != null ? `${metrics.ctxPct.toFixed(0)}%` : t('run:metrics.budget')}
            />
            <ContextRoleLegend
              slices={roleSlices}
              labels={roleLabels}
              freeLabel={t('run:role.free')}
              freeTokens={freeTokens}
            />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-foreground-secondary">{t('run:contextEmpty')}</p>
        )}
        {tokPerSec != null || isRunning || runState.toolCount > 0 ? (
          <dl className="mt-2">
            {tokPerSec != null || isRunning ? (
              <div className="panel-kv">
                <dt>{t('run:genSpeed')}</dt>
                <dd>{tokPerSec != null ? `${tokPerSec} tok/s` : t('run:waitingOutput')}</dd>
              </div>
            ) : null}
            {runState.toolCount > 0 ? (
              <div className="panel-kv">
                <dt>{t('run:toolLabel')}</dt>
                <dd>{runState.toolCount}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>

      {runState.usage ? (
        <section className="panel-section">
          <h3 className="panel-section-title">{t('run:usage')}</h3>
          <dl>
            <div className="panel-kv"><dt>{t('run:input')}</dt><dd>{runState.usage.input.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:output')}</dt><dd>{runState.usage.output.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:cacheReadLabel')}</dt><dd>{runState.usage.cacheRead.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:cacheWriteLabel')}</dt><dd>{runState.usage.cacheWrite.toLocaleString()}</dd></div>
            <div className="panel-kv"><dt>{t('run:cost')}</dt><dd>${runState.usage.cost.toFixed(4)}</dd></div>
          </dl>
        </section>
      ) : !isRunning && !metrics.contextPreview ? (
        <section className="panel-section">
          <p className="text-[12px] leading-relaxed text-foreground-secondary">{t('run:emptyHint')}</p>
        </section>
      ) : null}
    </div>
  )
}
