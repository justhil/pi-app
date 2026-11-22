import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, KeyRound, Search, Sparkles, Terminal, Undo2, X } from '@renderer/components/icons'
import type { BrowserBookmark } from '@shared/browser-types'
import { ipcClient } from '@renderer/lib/ipc-client'
import type { HistoryEntry } from './browser-history'
import { FaviconImg } from './favicon-img'

interface LocalDevServer {
  port: number
  url: string
  label: string
}

/**
 * Clean, utility-first New Tab page:
 * - Auto-focused instant search/URL box
 * - Auto-detected local DevServers (localhost:5173 / 3000 / 8080...)
 * - Recent frequent visits speed-dial (with hover remove, replacing hardcoded GitHub)
 * - Saved bookmarks speed-dial grid
 * - Quick actions (Sync sign-ins, Reopen closed tab)
 */
export function BrowserNewTabPage({
  bookmarks,
  history,
  onNavigate,
  onRemoveHistory,
  onOpenSync,
  onReopenClosed,
}: {
  bookmarks: BrowserBookmark[]
  history: HistoryEntry[]
  onNavigate: (rawInput: string) => void
  onRemoveHistory: (url: string) => void
  onOpenSync: () => void
  onReopenClosed: () => void
}) {
  const { t } = useTranslation('browser')
  const [input, setInput] = useState('')
  const [devServers, setDevServers] = useState<LocalDevServer[]>([])

  useEffect(() => {
    void (ipcClient.invoke('browser.devServers').catch(() => ({ servers: [] })) as Promise<{
      servers?: LocalDevServer[]
    }>).then((res) => setDevServers(res?.servers ?? []))
  }, [])

  const recentSites = history.slice(0, 6)

  return (
    <div className="studio-thin-scroll absolute inset-0 flex flex-col items-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-[540px] space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) onNavigate(input.trim())
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('address.placeholder')}
            className="h-10 w-full rounded-xl border border-border/75 bg-background pl-10 pr-4 text-[13px] text-foreground shadow-xs outline-none transition-colors focus:border-[var(--brand)]"
          />
        </form>

        {devServers.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Terminal className="h-3 w-3" />
              <span>{t('newTab.devServers')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {devServers.map((s) => (
                <button
                  key={s.port}
                  type="button"
                  onClick={() => onNavigate(s.url)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border/65 bg-background px-3 py-1.5 text-[12px] text-foreground transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--bg-hover)]"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-mono">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {recentSites.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <History className="h-3 w-3" />
              <span>{t('newTab.recentVisits')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recentSites.map((entry) => {
                const host = entry.url.replace(/^https?:\/\//i, '').split('/')[0]
                return (
                  <div
                    key={entry.url}
                    className="group relative flex items-center gap-2 rounded-lg border border-border/55 bg-background/80 px-2.5 py-2 transition-colors hover:border-border hover:bg-[var(--bg-hover)]"
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(entry.url)}
                      title={entry.url}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <FaviconImg className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground">
                          {entry.title || host}
                        </div>
                        <div className="truncate text-[10.5px] text-muted-foreground">{host}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      title={t('newTab.removeRecent')}
                      aria-label={t('newTab.removeRecent')}
                      onClick={() => onRemoveHistory(entry.url)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-foreground group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            <span>{t('bookmarks.title')}</span>
          </div>
          {bookmarks.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {bookmarks.slice(0, 12).map((b) => {
                const host = b.url.replace(/^https?:\/\//i, '').split('/')[0]
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onNavigate(b.url)}
                    title={b.url}
                    className="flex items-center gap-2 rounded-lg border border-border/55 bg-background/80 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-[var(--bg-hover)]"
                  >
                    <FaviconImg src={b.favicon} className="h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-foreground">
                        {b.title || host}
                      </div>
                      <div className="truncate text-[10.5px] text-muted-foreground">{host}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/65 px-4 py-5 text-center text-[12px] text-muted-foreground">
              {t('bookmarks.emptyHint')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onOpenSync}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-[11.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{t('sync.button')}</span>
          </button>
          <button
            type="button"
            onClick={onReopenClosed}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-[11.5px] text-foreground-secondary transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{t('nav.reopenTab')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
