import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Eye, EyeOff, Sparkles, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import type { ModelInfo, PiModelsConfigPayload, PiModelsProviderConfig } from '@shared/ipc-contract'
import {
  computeSpecFillPatch,
  resolveUpstreamModelSpec,
} from '@shared/models-dev-catalog'
import {
  PROVIDER_PRESETS,
  guessPresetForProvider,
  presetLabel,
  type ProviderPreset,
} from '@renderer/features/settings/model-provider-presets'
import { ModelEntryEditor, type LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import { ModelAutocompleteBar } from '@renderer/features/settings/model-autocomplete-bar'
import {
  ensureUpstreamCatalogLoaded,
  useUpstreamModelCatalogStore,
} from '@renderer/features/settings/upstream-model-catalog'
import {
  API_OPTS,
  ProviderAvatar,
  btnDanger,
  inputCls,
  maskApiKey,
  selectCls,
} from './models-settings-shared'

const fieldCls = 'settings-field h-[30px] py-0 text-[12.5px]'

export function ModelsProviderCard({
  pid,
  cardIndex,
  config,
  open,
  onToggleOpen,
  fetching,
  remoteIds,
  remoteError,
  apiKeyVisible,
  onToggleApiKeyVisible,
  expandedLocalModel,
  onToggleLocalModel,
  onApplyPreset,
  onUpdateProvider,
  onFetchRemote,
  onManualAdd,
  onRemoveProvider,
  onAddModel,
  onAddAllNew,
  onUpdateModel,
  onRemoveModel,
  sdkModels,
}: {
  pid: string
  cardIndex: number
  config: PiModelsConfigPayload
  open: boolean
  onToggleOpen: () => void
  fetching: boolean
  remoteIds: string[]
  remoteError?: string
  apiKeyVisible: boolean
  onToggleApiKeyVisible: () => void
  expandedLocalModel: Record<string, boolean>
  onToggleLocalModel: (rowKey: string) => void
  onApplyPreset: (preset: ProviderPreset) => void
  onUpdateProvider: (patch: Partial<PiModelsProviderConfig>) => void
  onFetchRemote: () => void
  onManualAdd: () => void
  onRemoveProvider: () => void
  onAddModel: (id: string) => void
  onAddAllNew: () => void
  onUpdateModel: (modelId: string, patch: Partial<LocalModelEntry>) => void
  onRemoveModel: (modelId: string) => void
  sdkModels?: ModelInfo[]
}) {
  const { t } = useTranslation('settings')
  const catalog = useUpstreamModelCatalogStore((s) => s.snapshot)
  const catalogLoading = useUpstreamModelCatalogStore((s) => s.loading)
  const p = config.providers[pid]
  const preset = guessPresetForProvider(pid, p)
  const displayName = p.name || presetLabel(preset, t) || pid
  const models = p.models ?? []
  const modelCount = models.length
  const hasOverrides = p.modelOverrides && Object.keys(p.modelOverrides).length > 0

  // Preload upstream catalog lazily once a provider card is open (zero unsolicited IPC on mount).
  useEffect(() => {
    if (open) void ensureUpstreamCatalogLoaded()
  }, [open])

  const localIds = useMemo(() => new Set(models.map((m) => m.id)), [models])

  const matchedSpecsByModelId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveUpstreamModelSpec>>()
    if (!catalog?.models.length) return map
    for (const m of models) {
      map.set(m.id, resolveUpstreamModelSpec(catalog, m.id, { providerId: pid, baseUrl: p.baseUrl }))
    }
    return map
  }, [catalog, models, p.baseUrl, pid])

  const fillableModels = useMemo(() => {
    const list: Array<{ id: string; patch: Partial<LocalModelEntry> }> = []
    for (const m of models) {
      const spec = matchedSpecsByModelId.get(m.id)
      if (!spec) continue
      const patch = computeSpecFillPatch(m, spec, { overwriteExisting: false })
      if (Object.keys(patch).length > 0) list.push({ id: m.id, patch })
    }
    return list
  }, [matchedSpecsByModelId, models])

  const handleFillAllMissing = () => {
    for (const item of fillableModels) {
      onUpdateModel(item.id, item.patch)
    }
  }

  return (
    <div
      className={cn(
        'settings-provider-card settings-card ui-enter',
        cardIndex < 5 && `stagger-${cardIndex + 1}`,
      )}
      style={cardIndex >= 5 ? { animationDelay: `${Math.min(cardIndex, 8) * 35}ms` } : undefined}
    >
      <button
        type="button"
        className="settings-provider-header interactive-row flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={onToggleOpen}
      >
        <ChevronRight className="settings-chevron h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} data-open={open} />
        <ProviderAvatar preset={preset} label={displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13.5px] font-medium text-foreground">{displayName}</span>
            {pid !== displayName ? <span className="truncate font-mono text-[11px] text-foreground-secondary">{pid}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-foreground-secondary">
            {p.baseUrl || t('models.notSetBaseUrl')}
            <span className="mx-1.5 text-border">·</span>
            {API_OPTS.find((o) => o.v === p.api)?.l || p.api || t('models.apiNotSetLabel')}
            <span className="mx-1.5 text-border">·</span>
            {maskApiKey(p.apiKey)}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted/70 px-2 py-0.5 text-[11px] tabular-nums text-foreground-secondary">
          {t('models.modelCount', { count: modelCount })}
        </span>
      </button>

      <div className="settings-expand-grid" data-open={open}>
        <div className="settings-expand-inner">
          <div className="settings-expand-content space-y-4 px-4 py-3.5">
            {/* Connection block (compact 2-row grid) */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center justify-between text-[11.5px] text-foreground-secondary">
                  <span>{t('models.labelName')}</span>
                  <select
                    aria-label={t('models.changeTemplate')}
                    className="max-w-[9.5rem] bg-transparent text-right text-[11px] text-foreground-secondary outline-none hover:text-foreground"
                    value=""
                    onChange={(e) => {
                      const pr = PROVIDER_PRESETS.find((x) => x.id === e.target.value)
                      if (pr) onApplyPreset(pr)
                    }}
                  >
                    <option value="">{t('models.fillFromTemplate')}</option>
                    {PROVIDER_PRESETS.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {presetLabel(pr, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  className={cn(inputCls, fieldCls)}
                  value={p.name || ''}
                  onChange={(e) => onUpdateProvider({ name: e.target.value || undefined })}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelApi')}</label>
                <select
                  className={cn(selectCls, fieldCls, 'w-full')}
                  value={p.api || 'openai-completions'}
                  onChange={(e) => onUpdateProvider({ api: e.target.value as PiModelsProviderConfig['api'] })}
                >
                  {API_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelBaseUrl')}</label>
                <input
                  className={cn(inputCls, fieldCls, 'font-mono text-[12px]')}
                  value={p.baseUrl || ''}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => onUpdateProvider({ baseUrl: e.target.value || undefined })}
                />
              </div>

              <div>
                <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelApiKey')}</label>
                <div className="relative">
                  <input
                    className={cn(inputCls, fieldCls, 'pr-8 font-mono text-[12px]')}
                    type={apiKeyVisible ? 'text' : 'password'}
                    value={p.apiKey || ''}
                    placeholder="$OPENAI_API_KEY"
                    onChange={(e) => onUpdateProvider({ apiKey: e.target.value || undefined })}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={onToggleApiKeyVisible}
                    aria-label={apiKeyVisible ? t('models.hideKeyLabel') : t('models.showKeyLabel')}
                  >
                    {apiKeyVisible ? <EyeOff className="h-3 w-3" strokeWidth={2} /> : <Eye className="h-3 w-3" strokeWidth={2} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Unified Models Workspace: instant autocomplete + optional remote fetch + clean list */}
            <div className="space-y-2.5 border-t border-[var(--settings-divider)] pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[12px] font-medium text-foreground">
                  {t('models.localCount', { count: modelCount })}
                </h4>
                <div className="flex items-center gap-2">
                  {fillableModels.length > 0 ? (
                    <button
                      type="button"
                      data-testid={`fill-missing-specs-${pid}`}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                      onClick={handleFillAllMissing}
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>{t('models.fillMissingSpecs', { count: fillableModels.length })}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cn(btnDanger, 'h-[26px] px-2 text-[11.5px]')}
                    onClick={onRemoveProvider}
                  >
                    <Trash2 className="mr-1 inline h-3 w-3" strokeWidth={2} />
                    {t('models.deleteBtn')}
                  </button>
                </div>
              </div>

              <ModelAutocompleteBar
                providerId={pid}
                baseUrl={p.baseUrl}
                catalog={catalog}
                catalogLoading={catalogLoading}
                remoteIds={remoteIds}
                remoteError={remoteError}
                fetchingRemote={fetching}
                sdkModels={sdkModels}
                localIds={localIds}
                onEnsureCatalog={() => void ensureUpstreamCatalogLoaded()}
                onAddModel={onAddModel}
                onAddAllRemote={onAddAllNew}
                onFetchRemote={onFetchRemote}
                onOpenBatchAdd={onManualAdd}
              />

              {modelCount > 0 ? (
                <div className="space-y-1.5">
                  {models.map((m) => {
                    const rowKey = `${pid}\0${m.id}`
                    const rowExpanded = expandedLocalModel[rowKey] === true
                    const matchedSpec = matchedSpecsByModelId.get(m.id) ?? null
                    return (
                      <div key={m.id} className={rowExpanded ? undefined : 'settings-virtual-row settings-virtual-row-sm'}>
                        <ModelEntryEditor
                          model={m}
                          expanded={rowExpanded}
                          matchedSpec={matchedSpec}
                          onToggleExpand={() => onToggleLocalModel(rowKey)}
                          onChange={(patch) => onUpdateModel(m.id, patch)}
                          onApplySpec={
                            matchedSpec
                              ? () =>
                                  onUpdateModel(
                                    m.id,
                                    computeSpecFillPatch(m, matchedSpec, { overwriteExisting: true }),
                                  )
                              : undefined
                          }
                          onRemove={() => onRemoveModel(m.id)}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--border-base)] px-3 py-4 text-center text-[12px] text-foreground-secondary">
                  {t('models.autocompleteEmptyHint')}
                </p>
              )}
            </div>

            {hasOverrides && <p className="text-[11.5px] text-foreground-secondary">{t('models.containsOverrides')}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
