import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Cpu, RefreshCw, ArrowUp } from '@renderer/components/icons'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { ipcClient, onAppUpdateAvailable } from '@renderer/lib/ipc-client'
import { showAppUpdateDialog } from '@renderer/lib/app-update-notify'
import { countAttention, listAttentionSessions, type SessionAttention } from '@renderer/lib/session-attention'
import { activateWorkspace, switchSessionInPlace } from '@renderer/lib/activate-workspace'
import { sessionFilesEqual } from '@renderer/lib/session-file-key'
import { useUIStore } from '@renderer/stores/ui-store'
import { SessionAttentionDot } from '@renderer/features/workspace/session-attention-dot'
import { ShellPopover } from './shell-popover'

type WorkerRow = { sessionFile: string; running: boolean; cwd: string }
type Popover = 'workers' | 'board' | null
const GROUPS: SessionAttention[] = ['needs-you', 'working', 'done']

export function StatusBar() {
  const { t, i18n } = useTranslation()
  const attention = useUIStore((s) => s.sessionAttention)
  const sessions = useUIStore((s) => s.sessions)
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const counts = countAttention(attention)
  const [status, setStatus] = useState<{ rss: number; total: number; workers: WorkerRow[] } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openUpdate, setOpenUpdate] = useState<(() => void) | null>(null)
  const [popover, setPopover] = useState<Popover>(null)
  const [confirmStop, setConfirmStop] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const boardAnchor = useRef<HTMLButtonElement>(null)
  const workersAnchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setPopover(null)
    setConfirmStop(null)
    setActionError(null)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await ipcClient.invoke('desktop.status', {})
      setStatus({ rss: res.rss, total: res.total, workers: res.workers })
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    const unsub = onAppUpdateAvailable((update) => setOpenUpdate(() => () => showAppUpdateDialog(update)))
    return () => {
      window.clearInterval(timer)
      unsub()
    }
  }, [refresh])

  useEffect(() => {
    const busy = counts.working + counts.needsYou > 0
    void ipcClient.invoke('desktop.setSleepBlock', { on: busy }).catch(() => {})
  }, [counts.working, counts.needsYou])

  const openSession = async (file: string) => {
    setActionError(null)
    try {
      let match = sessions.find((s) => sessionFilesEqual(s.sessionFile, file))
      const worker = status?.workers.find((row) => sessionFilesEqual(row.sessionFile, file))
      const workspace = match?.workspaceId || worker?.cwd || (match ? currentWorkspace : null)
      if (!match && workspace) {
        const result = await ipcClient.invoke('session.list', { workspaceId: workspace })
        match = result.sessions?.find((s: SessionItem) => sessionFilesEqual(s.sessionFile, file))
      }
      if (!match || !workspace) {
        setActionError(t('common:notification.sessionGone'))
        return
      }
      if (workspace === currentWorkspace) await switchSessionInPlace(match.sessionId, file)
      else await activateWorkspace(workspace, { sessionId: match.sessionId, sessionFile: file })
      close()
    } catch {
      setActionError(t('common:notification.openFailed'))
    }
  }

  const stopWorker = async (file: string) => {
    setStopping(true)
    setActionError(null)
    try {
      const result = await ipcClient.invoke('desktop.killWorker', { sessionFile: file })
      if (!result.ok) throw new Error('stop failed')
      setConfirmStop(null)
      await refresh()
    } catch {
      setActionError(t('common:operationFailed'))
    } finally {
      setStopping(false)
    }
  }

  const label = (kind: SessionAttention) => kind === 'needs-you'
    ? t('common:attention.needsYou')
    : kind === 'working' ? t('common:app.status.running') : t('common:attention.done')
  const rss = status?.rss || 0
  const gib = rss >= 1024 ** 3
  const memory = rss ? `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: gib ? 1 : 0 }).format(rss / 1024 ** (gib ? 3 : 2))} ${gib ? 'GB' : 'MB'}` : '—'
  const ratio = status?.total ? rss / status.total : 0
  const level = ratio >= 0.8 ? 'critical' : ratio >= 0.6 ? 'warning' : 'normal'
  const live = counts.working + counts.needsYou + counts.done

  return (
    <footer className="workbench-statusbar electron-no-drag" aria-label={t('common:statusBar.title')}>
      <button ref={boardAnchor} type="button" className="workbench-status-trigger" aria-haspopup="dialog" aria-expanded={popover === 'board'} aria-label={t('common:board.title')} onClick={() => setPopover((v) => v === 'board' ? null : 'board')}>
        {live === 0 ? <span className="flex items-center gap-2"><span className="status-ready-dot" />{t('common:app.status.ready')}</span> : (
          <>
            {counts.needsYou > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="needs-you" />{t('common:statusBar.needsYou', { count: counts.needsYou })}</span>}
            {counts.working > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="working" />{t('common:statusBar.running', { count: counts.working })}</span>}
            {counts.done > 0 && <span className="flex items-center gap-1.5"><SessionAttentionDot attention="done" />{t('common:statusBar.done', { count: counts.done })}</span>}
          </>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 rotate-180 opacity-60" />
      </button>
      <div className="ml-auto flex shrink-0 items-center">
        <button ref={workersAnchor} type="button" className="workbench-status-trigger tabular-nums" data-level={level} aria-haspopup="dialog" aria-expanded={popover === 'workers'} aria-label={t('common:statusBar.resources')} title={t('common:statusBar.memoryHint')} onClick={() => { setPopover((v) => v === 'workers' ? null : 'workers'); void refresh() }}>
          <Cpu className="h-3 w-3" /><span>{memory}</span>
        </button>
        {openUpdate && <button type="button" className="workbench-status-trigger" title={t('common:statusBar.update')} aria-label={t('common:statusBar.update')} onClick={openUpdate}><ArrowUp className="h-3 w-3" /></button>}
      </div>

      {popover && (
        <ShellPopover title={popover === 'board' ? t('common:board.title') : t('common:statusBar.resources')} anchorRef={popover === 'board' ? boardAnchor : workersAnchor} onClose={close}>
          {actionError && <p role="alert" className="workbench-error">{actionError}</p>}
          {popover === 'board' ? (
            live === 0 ? <div className="workbench-empty"><SessionAttentionDot attention="done" /><p>{t('common:board.empty')}</p><span>{t('common:board.emptyHint')}</span></div> : (
              GROUPS.map((kind) => {
                const files = listAttentionSessions(attention, kind)
                if (!files.length) return null
                return <section key={kind} className="workbench-group" aria-label={label(kind)}>
                  <h3 className="workbench-group-heading"><SessionAttentionDot attention={kind} />{label(kind)}<span>{files.length}</span></h3>
                  {files.map((file) => {
                    const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, file))
                    const worker = status?.workers.find((row) => sessionFilesEqual(row.sessionFile, file))
                    const workspace = match?.workspaceId || worker?.cwd || (match ? currentWorkspace : null)
                    return <button key={file} type="button" className="workbench-list-row" disabled={!workspace} title={!workspace ? t('common:notification.sessionGone') : undefined} onClick={() => void openSession(file)}>
                      <span className="workbench-row-title">{match?.title || file.split(/[\\/]/).pop()}</span>
                      <span className="workbench-row-detail">{workspace?.split(/[\\/]/).pop() || t('common:notification.sessionGone')}{match?.firstMessage ? ` · ${match.firstMessage}` : ''}</span>
                    </button>
                  })}
                </section>
              })
            )
          ) : (
            <>
              <div className="workbench-resource-summary"><div><span className="workbench-row-detail">{t('common:statusBar.memory')}</span><strong className="block text-xl font-medium tabular-nums">{memory}</strong></div><button type="button" className="workbench-icon" aria-label={t('common:refresh')} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></button></div>
              <p className="px-4 pb-3 text-xs leading-relaxed text-foreground-secondary">{t('common:statusBar.memoryHint')}</p>
              {loadError && <p role="alert" className="workbench-error">{t('common:statusBar.loadFailed')}</p>}
              {!status && !loadError ? <p role="status" className="workbench-empty">{t('common:loading')}</p> : status?.workers.length === 0 ? <p className="workbench-empty">{t('common:statusBar.noWorkers')}</p> : (
                <section className="workbench-group" aria-label={t('common:statusBar.workers')}>
                  <h3 className="workbench-group-heading">{t('common:statusBar.workers')}<span>{status?.workers.length}</span></h3>
                  {status?.workers.map((row) => {
                    const match = sessions.find((s) => sessionFilesEqual(s.sessionFile, row.sessionFile))
                    return <div key={row.sessionFile} className="workbench-resource-row">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5"><SessionAttentionDot attention={row.running ? 'working' : 'idle'} className="mt-1" /><div className="min-w-0"><div className="workbench-row-title">{match?.title || row.sessionFile.split(/[\\/]/).pop()}</div><div className="workbench-row-detail">{row.cwd.split(/[\\/]/).pop()} · {row.running ? t('common:app.status.running') : t('common:app.status.idle')}</div></div></div>
                      {confirmStop === row.sessionFile ? <div className="basis-full rounded-md border border-border p-3"><p className="mb-2 text-xs leading-relaxed">{t('common:statusBar.stopConfirm')}</p><div className="flex justify-end gap-2"><button type="button" className="workbench-button" disabled={stopping} onClick={() => setConfirmStop(null)}>{t('common:cancel')}</button><button type="button" className="workbench-button text-destructive" disabled={stopping} onClick={() => void stopWorker(row.sessionFile)}>{stopping ? t('common:loading') : t('common:statusBar.kill')}</button></div></div> : <button type="button" className="workbench-button" disabled={!row.running} onClick={() => setConfirmStop(row.sessionFile)}>{t('common:statusBar.kill')}</button>}
                    </div>
                  })}
                </section>
              )}
            </>
          )}
        </ShellPopover>
      )}
    </footer>
  )
}
