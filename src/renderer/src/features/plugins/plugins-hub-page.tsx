import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Cable,
  ChevronDown,
  MoreHorizontal,
  Plug,
  Puzzle,
  Search,
  Sparkles,
  X,
} from '@renderer/components/icons'
import { OverlayScrollHost } from '@renderer/components/ui/overlay-scrollbar'
import { openSettingsToPage } from '@renderer/lib/agent-purge-store'
import { cn } from '@renderer/lib/utils'
import { CuratedIntegrationItem, InstalledPluginItem } from './plugins-hub-items'
import { usePluginsHubData, type PluginCategory } from './use-plugins-hub-data'

function AddDropdownMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  if (!open) return null
  const actions = [
    { icon: Plug, label: t('common:pluginsHub.addMcp'), page: 'mcp' },
    { icon: Sparkles, label: t('common:pluginsHub.manageSkills'), page: 'skills' },
    { icon: Puzzle, label: t('common:pluginsHub.manageExtensions'), page: 'extensions' },
    { icon: Cable, label: t('common:pluginsHub.manageAdapters'), page: 'adapters' },
  ]
  return (
    <div
      role="menu"
      className="overlay-panel absolute right-0 top-full z-50 mt-1.5 w-[210px] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      {actions.map((act) => (
        <button
          key={act.page}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            openSettingsToPage(act.page)
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-foreground/90 transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground"
        >
          <act.icon className="h-3.5 w-3.5 shrink-0 opacity-75" />
          <span>{act.label}</span>
        </button>
      ))}
    </div>
  )
}

function PluginsSearchInput({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-secondary/55" />
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('common:pluginsHub.searchPlaceholder')}
        aria-label={t('common:pluginsHub.searchPlaceholder')}
        className="h-8 w-full rounded-full border border-border/65 bg-foreground/[0.03] pl-9 pr-8 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-foreground-secondary/50 focus:border-border"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common:sidebar.clearSearch')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function PluginsToolbar({
  query,
  category,
  onQueryChange,
  onCategoryChange,
}: {
  query: string
  category: PluginCategory
  onQueryChange: (q: string) => void
  onCategoryChange: (c: PluginCategory) => void
}) {
  const { t } = useTranslation()
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!addOpen) return
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [addOpen])
  const filters: { key: PluginCategory; label: string }[] = [
    { key: 'all', label: t('common:pluginsHub.filterAll') },
    { key: 'mcp', label: t('common:pluginsHub.filterMcp') },
    { key: 'skills', label: t('common:pluginsHub.filterSkills') },
    { key: 'extensions', label: t('common:pluginsHub.filterExtensions') },
  ]
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2.5">
      <PluginsSearchInput query={query} onChange={onQueryChange} />
      <div className="flex items-center rounded-full border border-border/55 bg-foreground/[0.03] p-0.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={category === f.key}
            onClick={() => onCategoryChange(f.key)}
            className={cn(
              'h-7 rounded-full px-3 text-[12px] transition-colors',
              category === f.key ? 'bg-foreground/[0.12] font-medium text-foreground' : 'text-foreground-secondary hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div ref={addRef} className="relative">
        <button
          type="button"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-foreground px-3.5 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90"
        >
          <span>{t('common:pluginsHub.add')}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', addOpen && 'rotate-180')} />
        </button>
        <AddDropdownMenu open={addOpen} onClose={() => setAddOpen(false)} />
      </div>
    </div>
  )
}

export function PluginsHubPage() {
  const { t } = useTranslation()
  const { installedRows, curatedCards } = usePluginsHubData()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PluginCategory>('all')
  const [showAllInstalled, setShowAllInstalled] = useState(false)
  const [showAllCurated, setShowAllCurated] = useState(false)

  const q = query.trim().toLowerCase()
  const filteredInstalled = useMemo(
    () =>
      installedRows.filter(
        (r) =>
          (category === 'all' || r.category === category) &&
          (!q || `${r.title} ${r.subtitle} ${r.badge}`.toLowerCase().includes(q)),
      ),
    [category, installedRows, q],
  )
  const filteredCurated = useMemo(
    () =>
      category !== 'all' && category !== 'extensions'
        ? []
        : curatedCards.filter((c) => !q || `${c.title} ${c.description} ${c.metaLine}`.toLowerCase().includes(q)),
    [category, curatedCards, q],
  )

  const visibleInstalled = showAllInstalled || q || category !== 'all' ? filteredInstalled : filteredInstalled.slice(0, 6)
  const visibleCurated = showAllCurated || q ? filteredCurated : filteredCurated.slice(0, 8)

  return (
    <OverlayScrollHost className="h-full min-h-0 flex-1 bg-[var(--chat-bg)]" scrollClassName="pb-12">
      <div className="mx-auto w-full max-w-[920px] px-6 pt-7 sm:px-10" data-testid="plugins-hub-page">
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{t('common:pluginsHub.title')}</h1>
          <button
            type="button"
            onClick={() => openSettingsToPage('extensions')}
            title={t('common:pluginsHub.manageExtensions')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-secondary hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <PluginsToolbar query={query} category={category} onQueryChange={setQuery} onCategoryChange={setCategory} />

        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-foreground">{t('common:pluginsHub.yourPlugins')}</h2>
            {!q && category === 'all' && filteredInstalled.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowAllInstalled((v) => !v)}
                className="inline-flex items-center gap-1 text-[12px] text-foreground-secondary hover:text-foreground"
              >
                <span>{showAllInstalled ? t('common:pluginsHub.showLess') : t('common:pluginsHub.showAll')}</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            ) : null}
          </div>
          {visibleInstalled.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center text-[12.5px] text-foreground-secondary/70">
              {q ? t('common:pluginsHub.emptyMatch') : t('common:pluginsHub.emptyInstalled')}
            </p>
          ) : (
            <div className="-mx-3 divide-y divide-border/30">
              {visibleInstalled.map((row) => <InstalledPluginItem key={row.uid} row={row} />)}
            </div>
          )}
        </section>

        {filteredCurated.length > 0 ? (
          <section className="mt-9">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-foreground">{t('common:pluginsHub.curatedSection')}</h2>
              {!q && filteredCurated.length > 8 ? (
                <button
                  type="button"
                  onClick={() => setShowAllCurated((v) => !v)}
                  className="inline-flex items-center gap-1 text-[12px] text-foreground-secondary hover:text-foreground"
                >
                  <span>{showAllCurated ? t('common:pluginsHub.showLess') : t('common:pluginsHub.showAll')}</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            <div className="-mx-3.5 grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
              {visibleCurated.map((card) => <CuratedIntegrationItem key={card.id} card={card} />)}
            </div>
          </section>
        ) : null}
      </div>
    </OverlayScrollHost>
  )
}
