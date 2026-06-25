import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Plus, Search } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export function ModelCatalogPicker({
  ids,
  localIds,
  loading,
  error,
  onAdd,
  onAddAllNew,
}: {
  ids: string[]
  localIds: Set<string>
  loading?: boolean
  error?: string
  onAdd: (id: string) => void
  onAddAllNew?: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return ids
    return ids.filter((id) => id.toLowerCase().includes(needle))
  }, [ids, q])

  const newCount = useMemo(() => ids.filter((id) => !localIds.has(id)).length, [ids, localIds])

  if (loading) {
    return (
      <div className="settings-catalog-shell ui-enter overflow-hidden rounded-xl border border-border/50 bg-gradient-to-b from-muted/25 to-transparent px-4 py-8 text-center">
        <div
          className="mx-auto h-7 w-7 rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--bg-3) 25%, color-mix(in srgb, var(--bg-3) 60%, var(--foreground) 8%) 50%, var(--bg-3) 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeleton-shimmer 1.2s ease-in-out infinite',
          }}
        />
        <p className="mt-3 text-[12px] text-muted-foreground animate-thinking-pulse">{t('models.fetching')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ui-enter rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[12px] text-destructive">
        {error}
      </div>
    )
  }

  if (!ids.length) {
    return (
      <div className="ui-enter rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-7 text-center text-[12px] text-muted-foreground">
        {t('models:fetchFirst')}
      </div>
    )
  }

  return (
    <div className="settings-catalog-shell ui-enter overflow-hidden rounded-xl border border-border/55 bg-gradient-to-b from-muted/20 via-transparent to-transparent">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2.5">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/45 transition-opacity duration-motion-fast" />
          <input
            className="settings-field-focus w-full rounded-lg border border-border/60 bg-background/80 py-1.5 pl-8 pr-2 text-[12px] transition-shadow duration-motion-fast"
            placeholder={t('models:searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length === 1 && !localIds.has(filtered[0])) {
                e.preventDefault()
                onAdd(filtered[0])
                setQ('')
              }
            }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground transition-colors duration-motion-fast">
          {filtered.length}/{ids.length}
          {newCount > 0 && <span className="ml-1 text-primary">· {t('models:canAdd', { count: newCount })}</span>}
        </span>
        {onAddAllNew && newCount > 0 && (
          <button
            type="button"
            className="settings-chip rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
            onClick={onAddAllNew}
          >
            {t('models:addAll')}
          </button>
        )}
      </div>

      <ul className="max-h-[min(280px,42vh)] overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <li className="py-6 text-center text-[12px] text-muted-foreground">{t('models:noMatchModel')}</li>
        ) : (
          filtered.map((id, i) => {
            const added = localIds.has(id)
            return (
              <li
                key={id}
                className={cn('ui-enter', i < 5 && `stagger-${i + 1}`)}
                style={i >= 5 ? { animationDelay: `${Math.min(i, 12) * 24}ms` } : undefined}
              >
                <div
                  className={cn(
                    'settings-catalog-row group flex items-center gap-2 rounded-lg px-2 py-1.5',
                    added && 'opacity-80',
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-mono text-[11px] transition-colors duration-motion-fast',
                      added ? 'text-muted-foreground' : 'text-foreground/90',
                    )}
                    title={id}
                  >
                    {id}
                  </span>
                  {added ? (
                    <span className="settings-added-badge flex shrink-0 items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[10px] text-muted-foreground">
                      <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                      {t('models:allAdded')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="settings-add-fab flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      aria-label={t('models:addBtn') + ' ' + id}
                      onClick={() => onAdd(id)}
                    >
                      <Plus className="h-4 w-4 transition-transform duration-motion-fast group-hover:rotate-90" strokeWidth={2.25} />
                    </button>
                  )}
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}