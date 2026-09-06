import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox, RefreshCw, Check, Circle } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { listAttentionSessions } from '@renderer/lib/session-attention'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { SessionAttentionDot } from '@renderer/features/workspace/session-attention-dot'
import { cn } from '@renderer/lib/utils'
import { ShellPopover } from './shell-popover'

type InboxItem = {
  notificationId: string
  workspaceId: string
  sessionId?: string
  sessionFile?: string
  outcome: string
  copy?: { title?: string; body?: string }
  unread?: boolean
  createdAt?: number
}

export function NotificationInbox() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const attention = useUIStore((s) => s.sessionAttention)
  const sessions = useUIStore((s) => s.sessions)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const waiting = listAttentionSessions(attention, 'needs-you')
  const unread = items.filter((item) => item.unread).length + waiting.length
  const close = useCallback(() => { setOpen(false); setActionError(null) }, [])

  const load = useCallback(async () => {
    try {
      const res = await ipcClient.invoke('notifications.inbox', {})
      setItems(res.items)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!loading && !loadFailed) void ipcClient.invoke('desktop.setBadge', { count: unread }).catch(() => {})
  }, [unread, loading, loadFailed])

  const openSession = async (workspaceId?: string, sessionId?: string, sessionFile?: string, notificationId?: string) => {
    if (!sessionFile) return
    setActionError(null)
    setPending(notificationId || sessionFile)
    try {
      const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, sessionFile))
      const workspace = match?.workspaceId || workspaceId || (match ? currentWorkspace : undefined)
      if (match && workspace === currentWorkspace) await switchSessionInPlace(match.sessionId, sessionFile)
      else if (workspace) await activateWorkspace(workspace, { sessionId: sessionId || match?.sessionId, sessionFile })
      else { setActionError(t('common:notification.sessionGone')); return }
      if (notificationId) await ipcClient.invoke('notifications.markRead', { id: notificationId })
      await load()
      close()
    } catch {
      setActionError(t('common:notification.openFailed'))
    } finally {
      setPending(null)
    }
  }

  const toggleRead = async (item: InboxItem) => {
    setPending(item.notificationId)
    setActionError(null)
    try {
      if (item.unread) await ipcClient.invoke('notifications.markRead', { id: item.notificationId })
      else await ipcClient.invoke('notifications.markUnread', { id: item.notificationId, unread: true })
      await load()
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <button ref={anchorRef} type="button" className="chrome-icon-btn notification-trigger workbench-icon" title={t('common:notification.inbox')} aria-label={t('common:notification.inbox')} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((v) => !v); void load() }}>
        <Inbox className="h-4 w-4" />
        {unread > 0 && <span className="notification-unread-dot" />}
      </button>
      {open && <ShellPopover title={t('common:notification.inbox')} anchorRef={anchorRef} onClose={close}>
        <div className="flex items-center justify-between px-4 py-2 text-xs text-foreground-secondary"><span>{t('common:notification.unreadCount', { count: unread })}</span><button type="button" className="workbench-icon" aria-label={t('common:refresh')} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></button></div>
        {actionError && <p role="alert" className="workbench-error">{actionError}</p>}
        {loadFailed && <div role="alert" className="workbench-error flex items-center justify-between gap-2"><span>{t('common:notification.loadFailed')}</span><button type="button" className="workbench-button" onClick={() => void load()}>{t('common:retry')}</button></div>}
        {waiting.length > 0 && <section className="workbench-group" aria-label={t('common:attention.needsYou')}>
          <h3 className="workbench-group-heading"><SessionAttentionDot attention="needs-you" />{t('common:attention.needsYou')}<span>{waiting.length}</span></h3>
          {waiting.map((file) => {
            const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, file))
            return <button key={file} type="button" className="workbench-list-row" disabled={!match || pending !== null} onClick={() => void openSession(match?.workspaceId, match?.sessionId, file)}>
              <span className="workbench-row-title">{match?.title || file.split(/[\\/]/).pop()}</span>
              <span className="workbench-row-detail">{match ? t('common:notification.continueAnswer') : t('common:notification.sessionGone')}</span>
            </button>
          })}
        </section>}
        {loading ? <p role="status" className="workbench-empty">{t('common:loading')}</p> : items.length === 0 && waiting.length === 0 && !loadFailed ? (
          <div className="workbench-empty"><Inbox className="h-6 w-6 opacity-50" /><p>{t('common:notification.empty')}</p><span>{t('common:notification.emptyHint')}</span></div>
        ) : items.length > 0 && <section className="workbench-group" aria-label={t('common:notification.history')}>
          <h3 className="workbench-group-heading">{t('common:notification.history')}<span>{items.length}</span></h3>
          {items.map((item) => (
            <div key={item.notificationId} className="notification-row" data-unread={item.unread || undefined}>
              <button type="button" className="workbench-list-row min-w-0 flex-1" disabled={!item.sessionFile || pending !== null} title={!item.sessionFile ? t('common:notification.sessionGone') : undefined} onClick={() => void openSession(item.workspaceId, item.sessionId, item.sessionFile, item.notificationId)}>
                <span className={cn('workbench-row-title', item.unread && 'font-semibold')}>{item.copy?.title || t('common:attention.done')}</span>
                {item.copy?.body && <span className="notification-preview">{item.copy.body}</span>}
                {item.createdAt && <time className="workbench-row-detail" dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(item.createdAt)}</time>}
              </button>
              <button type="button" className="workbench-icon mr-2 shrink-0" disabled={pending !== null} title={item.unread ? t('common:notification.markRead') : t('common:notification.markUnread')} aria-label={item.unread ? t('common:notification.markRead') : t('common:notification.markUnread')} onClick={() => void toggleRead(item)}>{item.unread ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}</button>
            </div>
          ))}
        </section>}
      </ShellPopover>}
    </>
  )
}
