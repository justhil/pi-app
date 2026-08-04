import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, X } from '@renderer/components/icons'
import { guardSessionSwitch } from '@renderer/lib/session-switch-guard'
import { openSubagentSessionPreview } from '@renderer/lib/subagent-session-navigation'
import { cn } from '@renderer/lib/utils'
import {
  normalizeTreeToolItem,
  type TreeToolChildState,
  type TreeToolItem,
} from './tree-tool-model'

export {
  normalizeTreeToolItem,
  type TreeToolChildState,
  type TreeToolChildView,
  type TreeToolItem,
  type TreeToolRunView,
} from './tree-tool-model'

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function TreeToolCard({ item, className }: { item: TreeToolItem; className?: string }) {
  const { t } = useTranslation()
  const view = normalizeTreeToolItem(item)
  const stateLabel = (state: TreeToolChildState): string => t(`timeline:tree.state.${state}`)

  const openChildSession = (sessionFile: string) => {
    guardSessionSwitch(() => {
      void openSubagentSessionPreview(sessionFile)
    })
  }

  return (
    <div className={cn('space-y-2 rounded-lg border border-border/40 bg-background/45 p-2.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-secondary">
        <span className="font-medium uppercase tracking-[0.08em] text-foreground/75">
          {view.mode || item.toolName || t('timeline:tree.title')}
        </span>
        {view.runId && <span className="truncate font-mono text-[10px]">{view.runId}</span>}
        <span className="ml-auto text-[10px] font-medium">{t(`timeline:tree.phase.${view.phase}`)}</span>
      </div>

      {(view.runningCount > 0 || view.completedCount > 0 || view.failedCount > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] tabular-nums text-foreground-secondary">
          {view.runningCount > 0 && <span>{t('timeline:tree.runningCount', { count: view.runningCount })}</span>}
          {view.completedCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" aria-hidden />
              {t('timeline:tree.completedCount', { count: view.completedCount })}
            </span>
          )}
          {view.failedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <X className="h-3 w-3" aria-hidden />
              {t('timeline:tree.failedCount', { count: view.failedCount })}
            </span>
          )}
        </div>
      )}

      {view.children.length > 0 && (
        <div className="space-y-1.5">
          {view.children.map((child) => {
            const failureText = child.error
              ?? (child.failureKind ? t(`timeline:tree.failure.${child.failureKind}`) : undefined)
            const sessionFile = child.sessionFile
            const openSessionLabel = sessionFile
              ? t('timeline:tree.openSession', { agent: child.agent })
              : undefined
            return (
              <div
                key={child.key}
                role={sessionFile ? 'button' : undefined}
                tabIndex={sessionFile ? 0 : undefined}
                aria-label={openSessionLabel}
                title={openSessionLabel}
                onClick={sessionFile ? () => openChildSession(sessionFile) : undefined}
                onKeyDown={sessionFile
                  ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      openChildSession(sessionFile)
                    }
                  : undefined}
                className={cn(
                  'rounded-md border border-border/30 px-2.5 py-2',
                  child.state === 'failed' && 'border-destructive/30 bg-destructive/[0.035]',
                  sessionFile && 'cursor-pointer transition-colors hover:border-border/60 hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {child.agent}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-medium',
                      child.state === 'failed' ? 'text-destructive' : 'text-foreground-secondary',
                    )}
                  >
                    {stateLabel(child.state)}
                  </span>
                  {sessionFile && (
                    <ChevronRight className="h-3 w-3 shrink-0 text-foreground-secondary" aria-hidden />
                  )}
                </div>
                {child.task && (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-foreground-secondary">
                    {child.task}
                  </p>
                )}
                {(child.toolCount != null || child.tokens != null || child.durationMs != null) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] tabular-nums text-foreground-secondary/80">
                    {child.toolCount != null && <span>{t('timeline:tree.tools', { count: child.toolCount })}</span>}
                    {child.tokens != null && <span>{t('timeline:tree.tokens', { count: child.tokens })}</span>}
                    {child.durationMs != null && <span>{formatDuration(child.durationMs)}</span>}
                  </div>
                )}
                {failureText && (
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-destructive">
                    {failureText}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {view.fallbackText && (view.children.length === 0 || view.phase === 'unknown') && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/30 p-2 text-[10px] leading-relaxed text-foreground-secondary">
          {view.fallbackText.slice(0, 4000)}
        </pre>
      )}
      {view.children.length === 0 && !view.fallbackText && (
        <div className="text-[11px] text-foreground-secondary">{t('timeline:tree.noDetails')}</div>
      )}
    </div>
  )
}
