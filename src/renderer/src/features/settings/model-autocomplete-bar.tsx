import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CloudDownload, Plus, Search, Sparkles, X } from '@renderer/components/icons'
import {
  resolveUpstreamModelSpec,
  searchModelSuggestions,
  type ModelSuggestionItem,
  type UpstreamCatalogSnapshot,
} from '@shared/models-dev-catalog'
import type { ModelInfo } from '@shared/ipc-contract'
import { cn } from '@renderer/lib/utils'
import { sanitizeModelId, validateModelId } from './model-id-utils'
import { btnOutline, formatContextK, formatShortPrice } from './models-settings-shared'
import { ModelCatalogPicker } from './model-catalog-picker'

export function ModelAutocompleteBar({
  providerId,
  baseUrl,
  catalog,
  catalogLoading,
  remoteIds,
  remoteError,
  fetchingRemote,
  sdkModels,
  localIds,
  onEnsureCatalog,
  onAddModel,
  onAddAllRemote,
  onFetchRemote,
  onOpenBatchAdd,
}: {
  providerId: string
  baseUrl?: string
  catalog: UpstreamCatalogSnapshot | null
  catalogLoading: boolean
  remoteIds: string[]
  remoteError?: string
  fetchingRemote: boolean
  sdkModels?: ModelInfo[]
  localIds: Set<string>
  onEnsureCatalog: () => void
  onAddModel: (id: string) => void
  onAddAllRemote: () => void
  onFetchRemote: () => void
  onOpenBatchAdd: () => void
}) {
  const { t } = useTranslation('settings')
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteDrawerOpen, setRemoteDrawerOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (fetchingRemote || remoteError || remoteIds.length > 0) {
      setRemoteDrawerOpen(true)
    }
  }, [fetchingRemote, remoteError, remoteIds.length])

  useEffect(() => {
    if (!dropdownOpen) return
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dropdownOpen])

  const suggestions = useMemo(
    () =>
      searchModelSuggestions(query, {
        catalog,
        remoteIds,
        sdkModels,
        existingIds: localIds,
        providerId,
        baseUrl,
        limit: 24,
      }),
    [baseUrl, catalog, localIds, providerId, query, remoteIds, sdkModels],
  )

  const sanitizedQuery = sanitizeModelId(query)
  const queryValidation = sanitizedQuery ? validateModelId(sanitizedQuery) : { ok: false as const }
  const exactInSuggestions = useMemo(
    () =>
      Boolean(
        sanitizedQuery &&
          suggestions.some((s) => s.id.toLowerCase() === sanitizedQuery.toLowerCase()),
      ),
    [sanitizedQuery, suggestions],
  )
  const customMatchedSpec = useMemo(
    () =>
      sanitizedQuery && queryValidation.ok && !exactInSuggestions
        ? resolveUpstreamModelSpec(catalog, sanitizedQuery, { providerId, baseUrl })
        : null,
    [baseUrl, catalog, exactInSuggestions, providerId, queryValidation.ok, sanitizedQuery],
  )

  const showCustomAddRow = Boolean(
    sanitizedQuery && queryValidation.ok && !exactInSuggestions && !localIds.has(sanitizedQuery),
  )

  const totalOptions = suggestions.length + (showCustomAddRow ? 1 : 0)

  useEffect(() => {
    setActiveIndex(0)
  }, [query, totalOptions])

  const commitAdd = (id: string) => {
    const clean = sanitizeModelId(id)
    if (!clean || localIds.has(clean)) return
    onAddModel(clean)
    setQuery('')
    setDropdownOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setDropdownOpen(false)
      return
    }
    if (!dropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setDropdownOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (totalOptions > 0) setActiveIndex((i) => (i + 1) % totalOptions)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (totalOptions > 0) setActiveIndex((i) => (i - 1 + totalOptions) % totalOptions)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showCustomAddRow && activeIndex === 0) {
        commitAdd(sanitizedQuery)
        return
      }
      const sugIdx = showCustomAddRow ? activeIndex - 1 : activeIndex
      const picked = suggestions[sugIdx]
      if (picked && !picked.alreadyAdded) {
        commitAdd(picked.id)
      } else if (sanitizedQuery && queryValidation.ok && !localIds.has(sanitizedQuery)) {
        commitAdd(sanitizedQuery)
      }
    }
  }

  const renderSpecTags = (item: Pick<ModelSuggestionItem, 'contextWindow' | 'maxTokens' | 'reasoning' | 'hasImage' | 'cost'>) => {
    const ctx = formatContextK(item.contextWindow)
    const out = formatContextK(item.maxTokens)
    const price = formatShortPrice(item.cost)
    const parts = [
      ctx ? `${ctx}` : '',
      out ? `↑${out}` : '',
      item.reasoning ? t('models.reasoningBadge') : '',
      item.hasImage ? t('models.imageLabel') : '',
      price,
    ].filter(Boolean)
    if (parts.length === 0) return null
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-foreground-secondary">
        {parts.map((part, idx) => (
          <span key={idx} className="rounded bg-muted/70 px-1 py-px">
            {part}
          </span>
        ))}
      </span>
    )
  }

  const sourceLabel = (src: ModelSuggestionItem['source']) => {
    if (src === 'remote') return t('models.sourceRemote')
    if (src === 'models.dev') return 'models.dev'
    return 'SDK'
  }

  const newRemoteCount = remoteIds.filter((id) => !localIds.has(id)).length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div ref={containerRef} className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
            strokeWidth={2}
          />
          <input
            ref={inputRef}
            data-testid={`model-autocomplete-input-${providerId}`}
            className="settings-field h-[32px] w-full rounded-lg border border-border/75 bg-background pl-8 pr-7 text-[12.5px] outline-none transition-colors focus:border-primary/60"
            placeholder={t('models.autocompletePlaceholder')}
            value={query}
            onFocus={() => {
              onEnsureCatalog()
              setDropdownOpen(true)
            }}
            onChange={(e) => {
              setQuery(e.target.value)
              setDropdownOpen(true)
            }}
            onKeyDown={handleKeyDown}
          />
          {query ? (
            <button
              type="button"
              aria-label={t('models.close')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}

          {dropdownOpen && (
            <div
              role="listbox"
              data-testid={`model-autocomplete-list-${providerId}`}
              className="absolute left-0 right-0 z-40 mt-1 max-h-[290px] overflow-y-auto rounded-lg border border-border/80 bg-popover p-1 shadow-xl"
            >
              {showCustomAddRow && (
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === 0}
                  onMouseEnter={() => setActiveIndex(0)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitAdd(sanitizedQuery)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                    activeIndex === 0 ? 'bg-[var(--bg-hover)] text-foreground' : 'text-foreground/90',
                  )}
                >
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate">
                    {t('models.addCustomInline', { id: sanitizedQuery })}
                  </span>
                  {customMatchedSpec ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10.5px] text-primary">
                      <Sparkles className="h-2.5 w-2.5" />
                      {formatContextK(customMatchedSpec.contextWindow) || customMatchedSpec.name}
                    </span>
                  ) : null}
                </button>
              )}

              {suggestions.length === 0 && !showCustomAddRow ? (
                <div className="px-2.5 py-4 text-center text-[12px] text-muted-foreground">
                  {catalogLoading ? t('models.catalogLoading') : t('models.noMatchModel')}
                </div>
              ) : (
                suggestions.map((item, idx) => {
                  const optIdx = showCustomAddRow ? idx + 1 : idx
                  const focused = activeIndex === optIdx
                  return (
                    <button
                      key={`${item.source}:${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={focused}
                      disabled={item.alreadyAdded}
                      onMouseEnter={() => setActiveIndex(optIdx)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => !item.alreadyAdded && commitAdd(item.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        focused && !item.alreadyAdded && 'bg-[var(--bg-hover)]',
                        item.alreadyAdded && 'cursor-default opacity-55',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-[12px] font-medium text-foreground">
                            {item.id}
                          </span>
                          {item.name && item.name !== item.id ? (
                            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
                              {item.name}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {renderSpecTags(item)}
                      {item.alreadyAdded ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <span className="shrink-0 rounded border border-border/50 px-1 py-px text-[10px] text-muted-foreground">
                          {sourceLabel(item.source)}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className={cn(btnOutline, 'h-[32px] border-primary/30 px-2.5 text-[12px] text-primary')}
          disabled={fetchingRemote}
          onClick={onFetchRemote}
        >
          <CloudDownload className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />
          {fetchingRemote
            ? t('models.fetching')
            : newRemoteCount > 0
              ? `${t('models.fetchModels')} (${newRemoteCount})`
              : t('models.fetchModels')}
        </button>

        <button
          type="button"
          className={cn(btnOutline, 'h-[32px] px-2.5 text-[12px]')}
          onClick={onOpenBatchAdd}
        >
          {t('models.batchAddBtn')}
        </button>
      </div>

      {remoteDrawerOpen && (fetchingRemote || remoteError || remoteIds.length > 0) ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between px-0.5 text-[11.5px] text-muted-foreground">
            <span>{t('models.remoteModels')}</span>
            {!fetchingRemote ? (
              <button
                type="button"
                className="rounded px-1 py-0.5 text-[11px] hover:bg-muted hover:text-foreground"
                onClick={() => setRemoteDrawerOpen(false)}
              >
                {t('models.hideRemoteList')}
              </button>
            ) : null}
          </div>
          <ModelCatalogPicker
            ids={remoteIds}
            localIds={localIds}
            loading={fetchingRemote}
            error={remoteError}
            onAdd={onAddModel}
            onAddAllNew={onAddAllRemote}
          />
        </div>
      ) : null}
    </div>
  )
}
