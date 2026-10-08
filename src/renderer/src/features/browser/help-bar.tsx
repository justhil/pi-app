import { useTranslation } from 'react-i18next'
import type { BrowserHelpRequest } from '@shared/browser-types'
import { cn } from '@renderer/lib/utils'
import { browserActions, useBrowserStore } from './browser-store'

/**
 * The agent is waiting on the user (browser_request_help). Rendered as ordinary DOM above the
 * page area, never over it: the native page view covers anything drawn in its rectangle.
 */
export function HelpBar({ activeTabId, where, className }: { activeTabId: string | null; where?: BrowserHelpRequest['where']; className?: string }) {
  const { t } = useTranslation('browser')
  const requests = useBrowserStore((s) => s.helpRequests)
  const list = Object.values(requests).filter((r) => !where || r.where === where)
  if (!list.length) return null
  const request: BrowserHelpRequest = list.find((r) => r.tabId === activeTabId) ?? list[0]
  const elsewhere = request.where === 'builtin' && !!request.tabId && request.tabId !== activeTabId
  return (
    <div role="alert" className={cn('flex shrink-0 items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px]', className)}>
      <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{t('agent.helpTitle')}</div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-foreground-secondary">{request.prompt}</div>
        {request.target ? <div className="mt-0.5 truncate text-muted-foreground">{t('agent.helpTarget', { target: request.target })}</div> : null}
        {request.until ? <div className="mt-0.5 truncate text-muted-foreground">{t('agent.helpUntil', { until: request.until })}</div> : null}
        {request.where === 'chrome' && !request.confirm ? <div className="mt-0.5 text-muted-foreground">{t('agent.helpInChrome')}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {elsewhere ? (
          <button type="button" className="rounded-md px-2 py-1 text-foreground-secondary hover:bg-[var(--bg-hover)]" onClick={() => void browserActions.focus(request.tabId)}>
            {t('agent.helpOtherTab')}
          </button>
        ) : null}
        <button type="button" className="rounded-md px-2 py-1 text-foreground-secondary hover:bg-[var(--bg-hover)]" onClick={() => void browserActions.respondHelp(request.id, 'cancelled')}>
          {request.confirm ? t('agent.helpDeny') : t('agent.helpGiveUp')}
        </button>
        <button type="button" className={cn('rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:opacity-90')} onClick={() => void browserActions.respondHelp(request.id, 'completed')}>
          {request.confirm ? t('agent.helpAllow') : t('agent.helpDone')}
        </button>
      </div>
    </div>
  )
}
