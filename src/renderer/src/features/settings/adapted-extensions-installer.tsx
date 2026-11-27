import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Check,
  ChevronRight,
  CloudDownload,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Settings,
  X,
} from '@renderer/components/icons'
import { resolveAdapterText, type AdapterJson } from '@extension-compat/adapter-schema'
import { invalidateAdapterSnapshots, useAdapterCatalog } from '@renderer/lib/adapter-catalog'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

export interface InstalledExtensionItem {
  id: string
  name?: string
  packageName?: string
  adapterId?: string
  registeredTools?: string[]
}

const COMPAT_STYLES: Record<string, string> = {
  native: 'bg-green-500/10 text-green-600 dark:text-green-400',
  basic: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  headless: 'bg-muted text-muted-foreground',
  blocked: 'bg-destructive/10 text-destructive',
}

type FilterTab = 'all' | 'uninstalled' | 'installed'
type InstallScope = 'global' | 'project'

const TIER_RANK: Record<string, number> = {
  native: 0,
  partial: 1,
  headless: 2,
  none: 3,
}

function tierToCompatKey(tier: string): string {
  if (tier === 'native') return 'native'
  if (tier === 'partial') return 'basic'
  if (tier === 'headless') return 'headless'
  return 'blocked'
}

function extractSourcePackageName(source: string): string {
  const s = source.trim()
  if (s.startsWith('npm:')) {
    const body = s.slice(4)
    if (body.startsWith('@')) {
      const secondAt = body.indexOf('@', 1)
      return secondAt > 0 ? body.slice(0, secondAt) : body
    }
    const at = body.indexOf('@')
    return at > 0 ? body.slice(0, at) : body
  }
  if (s.startsWith('git:')) {
    const clean = s.slice(4).replace(/\.git$/i, '').replace(/#.*$/, '')
    const segs = clean.split('/').filter(Boolean)
    return segs[segs.length - 1] || clean
  }
  return s
}

function normalizePluginKey(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  return s.startsWith('@') && s.includes('/') ? s.slice(s.indexOf('/') + 1) : s
}

export function isAdaptedPluginInstalled(
  adapter: AdapterJson,
  extensions: readonly InstalledExtensionItem[],
): boolean {
  const sourcePkg = adapter.install?.source ? extractSourcePackageName(adapter.install.source) : ''
  const candidateIdentities = new Set(
    [adapter.id, ...(adapter.match?.names ?? []), sourcePkg]
      .filter(Boolean)
      .map((name) => normalizePluginKey(name)),
  )

  for (const ext of extensions) {
    if (ext.adapterId && ext.adapterId === adapter.id) return true
    if (ext.packageName && candidateIdentities.has(normalizePluginKey(ext.packageName))) return true
    if (ext.name && candidateIdentities.has(normalizePluginKey(ext.name))) return true
  }
  return false
}

function hasConfigPage(adapter: AdapterJson): boolean {
  const c = adapter.config
  if (!c) return false
  return Boolean(c.customRenderer || (c.sections && c.sections.length > 0) || c.configFile || c.piSettingsKey)
}

function deriveCapabilities(adapter: AdapterJson, t: (key: string) => string): string[] {
  const caps: string[] = []
  if (adapter.interact) caps.push(t('settings:extensions.capInteract'))
  if (adapter.statusBar) caps.push(t('settings:extensions.capStatusBar'))
  if (adapter.widget) caps.push(t('settings:extensions.capWidget'))
  if (adapter.sidePanel) caps.push(t('settings:extensions.capSidePanel'))
  if (hasConfigPage(adapter)) caps.push(t('settings:extensions.capConfig'))
  if (adapter.toolCard) caps.push(t('settings:extensions.capToolCard'))
  return caps
}

export function AdaptedExtensionsInstaller({
  workspaceId,
  extensions,
  onInstalled,
}: {
  workspaceId: string | null
  extensions: readonly InstalledExtensionItem[]
  onInstalled: () => void
}) {
  const { t, i18n } = useTranslation()
  const catalog = useAdapterCatalog(workspaceId ?? '')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [scope, setScope] = useState<InstallScope>('global')
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [optimisticInstalled, setOptimisticInstalled] = useState<Set<string>>(() => new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const allAdapters = useMemo(() => catalog?.adapters ?? [], [catalog?.adapters])

  // Strictly only show adapters that declare a verified `install.source` (hiding deprecated/TUI-only/local ones).
  const installableAdapters = useMemo(
    () =>
      allAdapters.filter(
        (adapter) =>
          adapter.kind !== 'desktop' &&
          adapter.tier !== 'none' &&
          Boolean(adapter.install?.source?.trim()),
      ),
    [allAdapters],
  )

  const items = useMemo(() => {
    return installableAdapters.map((adapter) => {
      const text = resolveAdapterText(adapter, i18n.language)
      const installed =
        optimisticInstalled.has(adapter.id) || isAdaptedPluginInstalled(adapter, extensions)
      const capabilities = deriveCapabilities(adapter, t)
      return {
        adapter,
        displayName: text.displayName || adapter.displayName || adapter.id,
        description: text.description || adapter.description || '',
        source: adapter.install!.source,
        homepage: adapter.install?.homepage,
        installed,
        capabilities,
        configurable: hasConfigPage(adapter),
      }
    })
  }, [extensions, i18n.language, installableAdapters, optimisticInstalled, t])

  const installedCount = useMemo(() => items.filter((i) => i.installed).length, [items])
  const availableCount = items.length - installedCount

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => {
        if (filter === 'uninstalled' && item.installed) return false
        if (filter === 'installed' && !item.installed) return false
        if (!q) return true
        const hay = [
          item.displayName,
          item.adapter.id,
          item.description,
          item.source,
          ...(item.adapter.match?.tools ?? []),
          ...(item.adapter.match?.commands ?? []),
          ...item.capabilities,
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => {
        // Uninstalled first so ready-to-install items appear at top, then by tier (Native -> Basic -> Headless)
        if (a.installed !== b.installed) return a.installed ? 1 : -1
        const tierDiff = (TIER_RANK[a.adapter.tier] ?? 9) - (TIER_RANK[b.adapter.tier] ?? 9)
        if (tierDiff !== 0) return tierDiff
        return a.displayName.localeCompare(b.displayName)
      })
  }, [filter, items, query])

  if (items.length === 0) return null

  const effectiveScope: InstallScope = scope === 'project' && workspaceId ? 'project' : 'global'

  const cliCommandFor = (source: string) =>
    effectiveScope === 'project' ? `pi install -l ${source}` : `pi install ${source}`

  const handleCopyCommand = (adapterId: string, source: string) => {
    void navigator.clipboard.writeText(cliCommandFor(source)).then(() => {
      setCopiedId(adapterId)
      window.setTimeout(() => setCopiedId((cur) => (cur === adapterId ? null : cur)), 1500)
    })
  }

  const handleInstall = async (adapterId: string, displayName: string) => {
    if (installingId) return
    setInstallingId(adapterId)
    setRowErrors((prev) => {
      if (!(adapterId in prev)) return prev
      const next = { ...prev }
      delete next[adapterId]
      return next
    })
    try {
      const res = await ipcClient.invoke('extensions.install', {
        adapterId,
        scope: effectiveScope,
        ...(workspaceId ? { workspaceId } : {}),
      })
      if (!res?.ok) {
        const msg = res?.error || t('settings:extensions.installFailed')
        setRowErrors((prev) => ({ ...prev, [adapterId]: msg }))
        toast.error(`${displayName}: ${msg}`)
        return
      }
      setOptimisticInstalled((prev) => new Set(prev).add(adapterId))
      toast.success(t('settings:extensions.installSuccess', { name: displayName }))
      invalidateAdapterSnapshots()
      onInstalled()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings:extensions.installFailed')
      setRowErrors((prev) => ({ ...prev, [adapterId]: msg }))
      toast.error(`${displayName}: ${msg}`)
    } finally {
      setInstallingId(null)
    }
  }

  return (
    <div
      data-testid="adapted-extensions-installer"
      className="mb-3 overflow-hidden rounded-lg border border-border/60 bg-card/40"
    >
      <button
        type="button"
        aria-expanded={open}
        data-testid="adapted-extensions-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/35"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            strokeWidth={2}
          />
          <span className="truncate text-[13px] font-medium text-foreground">
            {t('settings:extensions.curatedTitle')}
          </span>
          <span className="hidden truncate text-[11.5px] text-muted-foreground sm:inline">
            {t('settings:extensions.curatedSubtitle')}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
          {availableCount > 0 ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {t('settings:extensions.curatedAvailableBadge', { count: availableCount })}
            </span>
          ) : null}
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {t('settings:extensions.curatedInstalledBadge', {
              installed: installedCount,
              total: items.length,
            })}
          </span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-border/50">
          {/* Filter & Scope Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/45 bg-muted/15 px-3.5 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
                strokeWidth={2}
              />
              <input
                type="text"
                data-testid="adapted-extensions-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings:extensions.curatedSearchPlaceholder')}
                className="h-[28px] w-full rounded-md border border-border/70 bg-background pl-8 pr-7 text-[12px] outline-none transition-colors focus:border-primary/55"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t('common:clear')}
                  onClick={() => setQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>

            <div className="settings-segmented flex h-[28px] shrink-0 items-center gap-0.5 rounded-md p-0.5">
              {(
                [
                  { id: 'all', label: `${t('settings:extensions.filterAll')} (${items.length})` },
                  { id: 'uninstalled', label: `${t('settings:extensions.filterUninstalled')} (${availableCount})` },
                  { id: 'installed', label: `${t('settings:extensions.filterInstalled')} (${installedCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={filter === tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={cn(
                    'rounded-[5px] px-2 py-0.5 text-[11px] tabular-nums transition-colors',
                    filter === tab.id
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              className="settings-segmented flex h-[28px] shrink-0 items-center gap-0.5 rounded-md p-0.5"
              title={t('settings:extensions.installScopeHint')}
            >
              <button
                type="button"
                aria-pressed={effectiveScope === 'global'}
                onClick={() => setScope('global')}
                className={cn(
                  'rounded-[5px] px-2 py-0.5 text-[11px] transition-colors',
                  effectiveScope === 'global'
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('settings:extensions.sourceGlobal')}
              </button>
              <button
                type="button"
                disabled={!workspaceId}
                aria-pressed={effectiveScope === 'project'}
                onClick={() => workspaceId && setScope('project')}
                className={cn(
                  'rounded-[5px] px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  effectiveScope === 'project'
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('settings:extensions.sourceProject')}
              </button>
            </div>
          </div>

          {/* Curated Adapter List */}
          {visibleItems.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-[12px] text-muted-foreground">
              {t('settings:extensions.curatedNoMatch')}
            </div>
          ) : (
            <div className="max-h-[420px] divide-y divide-border/45 overflow-y-auto">
              {visibleItems.map((item) => {
                const compatKey = tierToCompatKey(item.adapter.tier)
                const isInstalling = installingId === item.adapter.id
                const busyOther = Boolean(installingId && !isInstalling)
                const rowErr = rowErrors[item.adapter.id]

                return (
                  <div
                    key={item.adapter.id}
                    data-testid={`adapted-ext-row-${item.adapter.id}`}
                    className="px-3.5 py-2.5 transition-colors hover:bg-muted/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium text-foreground">
                            {item.displayName}
                          </span>
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider',
                              COMPAT_STYLES[compatKey],
                            )}
                          >
                            {compatKey}
                          </span>
                          {item.capabilities.map((cap) => (
                            <span
                              key={cap}
                              className="rounded bg-muted/75 px-1.5 py-px text-[10.5px] text-foreground-secondary"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>

                        {item.description ? (
                          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground/85">
                            {item.description}
                          </p>
                        ) : null}

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/75">
                          <code className="truncate font-mono text-[11px]">{item.source}</code>
                          <button
                            type="button"
                            onClick={() => handleCopyCommand(item.adapter.id, item.source)}
                            title={cliCommandFor(item.source)}
                            aria-label={t('settings:extensions.copyInstallCmd')}
                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
                          >
                            {copiedId === item.adapter.id ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                          {item.homepage ? (
                            <button
                              type="button"
                              onClick={() =>
                                void ipcClient
                                  .invoke('shell.openExternal', { url: item.homepage! })
                                  .catch(() => {})
                              }
                              title={item.homepage}
                              aria-label={t('settings:extensions.openHomepage')}
                              className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        {item.installed ? (
                          <>
                            {item.configurable ? (
                              <button
                                type="button"
                                onClick={() =>
                                  useUIStore.getState().requestExtensionConfig(item.adapter.id)
                                }
                                title={t('settings:extensions.openAdapterConfig')}
                                className="inline-flex h-[26px] items-center gap-1 rounded-md border border-border/70 px-2 text-[11.5px] text-foreground-secondary hover:bg-muted hover:text-foreground"
                              >
                                <Settings className="h-3 w-3" />
                                <span>{t('settings:extensions.configureShort')}</span>
                              </button>
                            ) : null}
                            <span
                              data-testid={`adapted-ext-installed-${item.adapter.id}`}
                              className="inline-flex h-[26px] items-center gap-1 rounded-md bg-emerald-500/10 px-2 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400"
                            >
                              <Check className="h-3 w-3" strokeWidth={2.2} />
                              <span>{t('settings:extensions.installedBadge')}</span>
                            </span>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isInstalling || busyOther}
                            data-testid={`adapted-ext-install-${item.adapter.id}`}
                            onClick={() => void handleInstall(item.adapter.id, item.displayName)}
                            className="inline-flex h-[27px] items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>{t('settings:extensions.installingBtn')}</span>
                              </>
                            ) : (
                              <>
                                <CloudDownload className="h-3.5 w-3.5" strokeWidth={2} />
                                <span>{t('settings:extensions.installBtn')}</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {rowErr ? (
                      <div
                        role="alert"
                        className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-2.5 py-1.5 text-[11.5px] text-destructive"
                      >
                        <span className="min-w-0 flex-1 break-all">{rowErr}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyCommand(item.adapter.id, item.source)}
                            className="rounded border border-destructive/30 px-1.5 py-0.5 text-[11px] hover:bg-destructive/12"
                          >
                            {t('settings:extensions.copyInstallCmd')}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(installingId)}
                            onClick={() => void handleInstall(item.adapter.id, item.displayName)}
                            className="rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-medium hover:bg-destructive/25"
                          >
                            {t('common:retry')}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
