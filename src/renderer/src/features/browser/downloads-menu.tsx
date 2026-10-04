import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserDownloadInfo } from '@shared/browser-types'
import { CloudDownload, FolderOpen, X } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { browserActions, useBrowserStore } from './browser-store'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

function DownloadRow({ d }: { d: BrowserDownloadInfo }) {
  const { t } = useTranslation('browser')
  const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0
  const detail =
    d.state === 'progressing'
      ? [d.total > 0 ? `${formatBytes(d.received)} / ${formatBytes(d.total)}` : formatBytes(d.received), d.speed > 0 ? `${formatBytes(d.speed)}/s` : '']
          .filter(Boolean)
          .join(' · ')
      : d.state === 'completed' && d.total > 0
        ? `${formatBytes(d.total)} · ${t('downloads.state.completed')}`
        : t(`downloads.state.${d.state}`)
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-foreground" title={d.savePath}>{d.fileName}</div>
        <div className={cn('truncate text-[10.5px] tabular-nums', d.state === 'failed' ? 'text-destructive/80' : 'text-foreground-tertiary')}>
          {detail}
          {d.via === 'aria2' && d.state === 'progressing' ? <span className="ml-1.5 opacity-70">aria2</span> : null}
        </div>
        {d.state === 'progressing' ? (
          <div className="mt-1 h-[2px] overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-foreground/50 transition-[width] duration-300" style={{ width: d.total > 0 ? `${pct}%` : '30%' }} />
          </div>
        ) : null}
      </div>
      {d.state === 'progressing' ? (
        <button type="button" aria-label={t('downloads.cancel')} title={t('downloads.cancel')} onClick={() => void browserActions.cancelDownload(d.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-tertiary hover:bg-[var(--bg-active)] hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      ) : (
        <button type="button" aria-label={t('downloads.reveal')} title={t('downloads.reveal')} onClick={() => void browserActions.revealDownload(d.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-tertiary opacity-0 hover:bg-[var(--bg-active)] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100">
          <FolderOpen className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/** Toolbar button + list of this session's downloads. Hidden until something was downloaded. */
export function DownloadsMenu({ buttonClass }: { buttonClass: string }) {
  const { t } = useTranslation('browser')
  const downloads = useBrowserStore((s) => s.downloads)
  const [open, setOpen] = useState(false)
  const list = Object.values(downloads).sort((a, b) => b.startedAt - a.startedAt)
  if (list.length === 0) return null
  const active = list.filter((d) => d.state === 'progressing').length
  return (
    <div className="relative">
      <button
        type="button"
        className={cn(buttonClass, 'relative', open && 'bg-[var(--bg-active)]')}
        title={active ? t('downloads.active', { count: active }) : t('downloads.title')}
        aria-label={t('downloads.title')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <CloudDownload className="h-3.5 w-3.5" />
        {active ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> : null}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" aria-label={t('downloads.title')} className="absolute right-0 top-8 z-50 w-[280px] rounded-lg border border-border/60 bg-popover p-1 text-popover-foreground shadow-lg">
            <div className="flex items-center px-2 pb-1 pt-1 text-[10.5px] text-muted-foreground/70">
              <span className="flex-1">{t('downloads.title')}</span>
              {list.length > active ? (
                <button type="button" className="rounded px-1 hover:text-foreground" onClick={() => void browserActions.clearDownloads()}>
                  {t('downloads.clear')}
                </button>
              ) : null}
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {list.map((d) => <DownloadRow key={d.id} d={d} />)}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
