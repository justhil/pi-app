import { useTranslation } from 'react-i18next'
import { formatTokens } from '@renderer/lib/format-tokens'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import type { useComposerMetrics } from './use-composer-metrics'

type Metrics = ReturnType<typeof useComposerMetrics>

const R = 6.5
const C = 2 * Math.PI * R

/** Context usage indicator (ring / percent / ring+percent / pill) plus optional live tokens/s. */
export function ComposerMetricsInline({ metrics, isRunning }: { metrics: Metrics; isRunning?: boolean }) {
  const { t } = useTranslation()
  const mode = useUIStore((s) => s.uiCustomization?.composerMetricsMode ?? 'ring')
  const showTps = useUIStore((s) => s.uiCustomization?.composerShowTps ?? true)
  const showCtx = metrics.contextWindow != null || metrics.estContextTokens != null
  const pct = Math.max(0, Math.min(100, metrics.ctxPct ?? 0))
  const isHigh = pct >= 80
  const pctText = metrics.ctxPct == null ? '—' : `${Math.round(pct)}%`
  const tpsLabel = metrics.tps != null && metrics.tps > 0 ? `${Math.round(metrics.tps)} tps` : null

  if (!showCtx && (!tpsLabel || !showTps)) return null

  const contextTitle = t('composer:contextRing', {
    used: metrics.estContextTokens == null ? '?' : formatTokens(metrics.estContextTokens),
    total: metrics.contextWindow != null ? formatTokens(metrics.contextWindow) : '?',
    pct: metrics.ctxPct == null ? '?' : pct.toFixed(1),
  })
  const cacheTitle =
    metrics.cacheHitPct != null
      ? `${t('composer:cacheStats', {
          pct: metrics.cacheHitPct.toFixed(0),
          read: formatTokens(metrics.cacheRead ?? 0),
        })}${metrics.cacheWrite > 0 ? t('composer:cacheWrite', { write: formatTokens(metrics.cacheWrite) }) : ''}`
      : null
  const title = cacheTitle ? `${contextTitle} · ${cacheTitle}` : contextTitle

  const ringSvg = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      data-pi-slot="composer-context-ring"
      className={cn('composer-context-ring shrink-0', isHigh && 'is-high')}
    >
      <circle cx="8" cy="8" r={R} className="track" />
      <circle
        cx="8"
        cy="8"
        r={R}
        className="value"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - Math.max(pct, 2) / 100)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )

  return (
    <div
      data-pi-slot="composer-metrics"
      data-metrics-mode={mode}
      className="composer-metrics-inline flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums leading-none text-foreground-secondary/65"
    >
      {tpsLabel && isRunning && showTps ? (
        <span data-pi-slot="composer-tps" title={t('composer:tpsHint')}>
          {tpsLabel}
        </span>
      ) : null}
      {showCtx && mode !== 'hidden' && (
        <span
          className={cn(
            'inline-flex h-7 items-center justify-center gap-1 px-1',
            isHigh && 'text-amber-600 dark:text-amber-400',
          )}
          title={title}
          aria-label={title}
          role="img"
        >
          {(mode === 'ring' || mode === 'ring-percent') && ringSvg}
          {(mode === 'percent' || mode === 'ring-percent') && (
            <span className="font-mono text-[11px]">{pctText}</span>
          )}
          {mode === 'pill' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/65 bg-[var(--bg-1)]/60 px-2 py-0.5">
              <span className="h-1.5 w-7 overflow-hidden rounded-full bg-border/60">
                <span
                  className={cn(
                    'block h-full rounded-full transition-all',
                    isHigh ? 'bg-amber-500' : 'bg-foreground-secondary/75',
                  )}
                  style={{ width: `${Math.max(pct, 4)}%` }}
                />
              </span>
              <span className="font-mono text-[10.5px]">{pctText}</span>
            </span>
          )}
        </span>
      )}
    </div>
  )
}
