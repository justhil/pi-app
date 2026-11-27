import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Globe, RefreshCw, Search, ShieldCheck, X } from '@renderer/components/icons'
import { ipcClient } from '@renderer/lib/ipc-client'

import { cn } from '@renderer/lib/utils'

interface ImportSourceInfo {
  id: string
  label: string
  profiles: { directory: string; name: string }[]
}

interface SiteGroup {
  site: string
  count: number
  excluded?: 'device-bound'
}

interface DiskPreview {
  sites: SiteGroup[]
  stats: { appBound: number; expired: number; partitioned: number; undecryptable: number; keyringUnavailable: boolean }
}

/**
 * Three-track sign-in sync modal:
 * 1. Live Chrome/Edge extension sync (calls chrome.cookies.getAll inside Chrome, bypassing Windows Chrome 127+ v20 App-Bound lock)
 * 2. Local browser SQLite import (Firefox & non-v20 Chromium profiles via existing cookie-import service)
 */
export function CookieSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('browser')
  const [tab, setTab] = useState<'extension' | 'disk'>('extension')
  const [query, setQuery] = useState('')
  const [replaceExisting, setReplaceExisting] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [syncing, setSyncing] = useState(false)

  // Track 1: Live Chrome extension
  const [extConnected, setExtConnected] = useState(false)
  const [extLoading, setExtLoading] = useState(false)
  const [extSites, setExtSites] = useState<SiteGroup[]>([])
  const [extError, setExtError] = useState<string | null>(null)

  // Track 2: Disk import
  const [sources, setSources] = useState<ImportSourceInfo[]>([])
  const [sourceId, setSourceId] = useState('')
  const [profileDir, setProfileDir] = useState('')
  const [diskLoading, setDiskLoading] = useState(false)
  const [diskPreview, setDiskPreview] = useState<DiskPreview | null>(null)

  const loadExtSites = useCallback(async () => {
    setExtLoading(true)
    setExtError(null)
    try {
      const res = (await ipcClient.invoke('browser.cookies.chromeSites')) as {
        connected: boolean
        sites: SiteGroup[]
        error?: string
      }
      setExtConnected(Boolean(res?.connected))
      setExtSites(res?.sites ?? [])
      setExtError(res?.error ?? null)
    } catch (e) {
      setExtConnected(false)
      setExtError(e instanceof Error ? e.message : String(e))
    } finally {
      setExtLoading(false)
    }
  }, [])

  const loadDiskSources = useCallback(async () => {
    try {
      const res = (await ipcClient.invoke('browser.cookies.sources')) as { sources?: ImportSourceInfo[] }
      const list = res?.sources ?? []
      setSources(list)
      if (list.length > 0 && !sourceId) {
        const first = list[0]
        setSourceId(first.id)
        setProfileDir(first.profiles[0]?.directory ?? '')
      }
    } catch {
      setSources([])
    }
  }, [sourceId])

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    void loadExtSites()
    void loadDiskSources()
  }, [open, loadExtSites, loadDiskSources])

  useEffect(() => {
    if (!open || tab !== 'disk' || !sourceId || !profileDir) return
    setDiskLoading(true)
    void (ipcClient.invoke('browser.cookies.preview', { sourceId, profileDir }) as Promise<DiskPreview>)
      .then((res) => setDiskPreview(res))
      .catch(() => setDiskPreview(null))
      .finally(() => setDiskLoading(false))
  }, [open, tab, sourceId, profileDir])

  const activeSites = tab === 'extension' ? extSites : (diskPreview?.sites ?? [])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return activeSites
    return activeSites.filter((s) => s.site.toLowerCase().includes(q))
  }, [activeSites, query])

  if (!open) return null

  const toggleSite = (site: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(site)) next.delete(site)
      else next.add(site)
      return next
    })
  }

  const runSync = async () => {
    if (selected.size === 0 || syncing) return
    setSyncing(true)
    try {
      if (tab === 'extension') {
        const res = (await ipcClient.invoke('browser.cookies.chromeSync', {
          sites: [...selected],
          replace: replaceExisting,
        })) as { imported: number; failed: number }
        toast.success(t('sync.done', { count: res.imported, sites: selected.size }))
      } else {
        const res = (await ipcClient.invoke('browser.cookies.import', {
          sourceId,
          profileDir,
          sites: [...selected],
          replace: replaceExisting,
        })) as { imported: number; failed: number }
        toast.success(t('sync.done', { count: res.imported, sites: selected.size }))
      }
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('sync.failed'))
    } finally {
      setSyncing(false)
    }
  }

  const currentSource = sources.find((s) => s.id === sourceId)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      data-browser-overlay=""
      aria-label={t('sync.title')}
      className="overlay-backdrop fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="overlay-panel flex max-h-[82vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border/85 bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-foreground">{t('sync.title')}</div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t('sync.subtitle')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 border-b border-border/50 px-4 py-2 text-[12px]">
          <button
            type="button"
            onClick={() => {
              setTab('extension')
              setSelected(new Set())
            }}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              tab === 'extension'
                ? 'bg-[var(--bg-active)] text-foreground'
                : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
          >
            {t('sync.tabExtension')}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('disk')
              setSelected(new Set())
            }}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              tab === 'disk'
                ? 'bg-[var(--bg-active)] text-foreground'
                : 'text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground',
            )}
          >
            {t('sync.tabDisk')}
          </button>
          <button
            type="button"
            onClick={() => (tab === 'extension' ? void loadExtSites() : void loadDiskSources())}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
            title={t('nav.reload')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (extLoading || diskLoading) && 'animate-spin')} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 py-3">
          {tab === 'extension' && !extConnected ? (
            <div className="rounded-lg border border-border/65 bg-[var(--bg-1)]/50 p-3.5 text-[12px] leading-relaxed text-foreground-secondary">
              <div className="font-medium text-foreground">{t('sync.extNotConnectedTitle')}</div>
              <p className="mt-1 text-muted-foreground">{t('sync.extNotConnectedDesc')}</p>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('pi-desktop:open-settings'))
                }}
                className="mt-2.5 inline-flex h-7 items-center rounded-md bg-foreground px-3 text-[11.5px] font-medium text-background hover:opacity-90"
              >
                {t('sync.openBrowserSettings')}
              </button>
            </div>
          ) : null}

          {tab === 'extension' && extError ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
              {extError}
            </div>
          ) : null}

          {tab === 'disk' ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <select
                value={sourceId}
                onChange={(e) => {
                  const id = e.target.value
                  setSourceId(id)
                  const src = sources.find((s) => s.id === id)
                  setProfileDir(src?.profiles[0]?.directory ?? '')
                  setSelected(new Set())
                }}
                className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {currentSource && currentSource.profiles.length > 0 ? (
                <select
                  value={profileDir}
                  onChange={(e) => {
                    setProfileDir(e.target.value)
                    setSelected(new Set())
                  }}
                  className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none"
                >
                  {currentSource.profiles.map((p) => (
                    <option key={p.directory} value={p.directory}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {diskPreview && diskPreview.stats.appBound > 0 ? (
                <div className="w-full rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                  {t('sync.v20Warning', { count: diskPreview.stats.appBound })}{' '}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => setTab('extension')}
                  >
                    {t('sync.switchToExtension')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeSites.length > 0 ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('sync.searchPlaceholder')}
                  className="h-7 w-full rounded-md border border-border/70 bg-background pl-8 pr-2.5 text-[12px] outline-none focus:border-[var(--brand)]"
                />
              </div>

              <div className="studio-thin-scroll min-h-[180px] max-h-[280px] flex-1 overflow-y-auto rounded-lg border border-border/60 p-1">
                {filtered.map((item) => {
                  const disabled = Boolean(item.excluded)
                  const checked = selected.has(item.site)
                  return (
                    <button
                      key={item.site}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleSite(item.site)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                        disabled
                          ? 'cursor-not-allowed opacity-45'
                          : checked
                            ? 'bg-[var(--brand)]/10 text-foreground'
                            : 'hover:bg-[var(--bg-hover)] text-foreground-secondary',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-[var(--brand)] bg-[var(--brand)] text-white'
                            : 'border-border/80 bg-background',
                        )}
                      >
                        {checked ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <Globe className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="min-w-0 flex-1 truncate font-mono">{item.site}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {disabled ? t('sync.excludedSensitive') : `${item.count} cookies`}
                      </span>
                    </button>
                  )
                })}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-foreground-secondary">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="accent-[var(--brand)]"
                />
                <span>{t('sync.replaceExisting')}</span>
              </label>
            </>
          ) : !extLoading && !diskLoading && (tab === 'disk' || extConnected) ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">{t('sync.noSites')}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/55 bg-[var(--bg-1)]/35 px-4 py-2.5 text-[11.5px]">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t('sync.privacyNote')}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded-md px-2.5 text-muted-foreground hover:bg-[var(--bg-hover)] hover:text-foreground"
            >
              {t('annotate.cancel')}
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || syncing}
              onClick={() => void runSync()}
              className="h-7 rounded-md bg-foreground px-3 font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {syncing
                ? t('tab.loading')
                : t('sync.importSelected', { count: selected.size })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
