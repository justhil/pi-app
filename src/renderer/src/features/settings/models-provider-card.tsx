import { useTranslation } from 'react-i18next'
import { ChevronRight, CloudDownload, Eye, EyeOff, Trash2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { PiModelsConfigPayload, PiModelsProviderConfig } from '@shared/ipc-contract'
import {
  PROVIDER_PRESETS,
  guessPresetForProvider,
  type ProviderPreset,
} from '@renderer/features/settings/model-provider-presets'
import { ModelCatalogPicker } from '@renderer/features/settings/model-catalog-picker'
import { ModelEntryEditor, type LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import {
  API_OPTS,
  ProviderAvatar,
  btnOutline,
  inputCls,
  maskApiKey,
  selectCls,
} from './models-settings-shared'

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
}) {
  const { t } = useTranslation()
  const p = config.providers[pid]
  const preset = guessPresetForProvider(pid, p)
  const displayName = p.name || preset?.label || pid
  const modelCount = p.models?.length ?? 0
  const hasOverrides = p.modelOverrides && Object.keys(p.modelOverrides).length > 0

  return (
    <div
      className={cn(
        'settings-provider-card ui-enter overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-sm',
        cardIndex < 5 && `stagger-${cardIndex + 1}`,
      )}
      style={cardIndex >= 5 ? { animationDelay: `${Math.min(cardIndex, 8) * 35}ms` } : undefined}
    >
      <button
        type="button"
        className="settings-provider-header interactive-row flex w-full items-center gap-3 px-3 py-3 text-left"
        onClick={onToggleOpen}
      >
        <ChevronRight className="settings-chevron h-4 w-4 shrink-0 text-muted-foreground" data-open={open} />
        <ProviderAvatar preset={preset} label={displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{displayName}</span>
            <span className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{pid}</span>
            {preset && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{preset.label}</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {p.baseUrl || t('models:notSetBaseUrl')}
            <span className="mx-1.5 text-border">·</span>
            {API_OPTS.find((o) => o.v === p.api)?.l || p.api || t('models:apiNotSetLabel')}
            <span className="mx-1.5 text-border">·</span>
            {maskApiKey(p.apiKey)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] font-medium tabular-nums">{modelCount}</div>
          <div className="text-[10px] text-muted-foreground">{t('models:modelLabel')}</div>
        </div>
      </button>

      <div className="settings-expand-grid" data-open={open}>
        <div className="settings-expand-inner">
          <div className="settings-expand-content space-y-4 border-t border-border/40 bg-background/30 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{t('models:changeTemplate')}</span>
              {PROVIDER_PRESETS.slice(0, 6).map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  className="settings-chip rounded-full border border-border/60 px-2 py-0.5 text-[10px]"
                  title={pr.tagline}
                  onClick={() => onApplyPreset(pr)}
                >
                  {pr.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('models:labelName')}</label>
                <input
                  className={inputCls}
                  value={p.name || ''}
                  onChange={(e) => onUpdateProvider({ name: e.target.value || undefined })}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('models:labelApi')}</label>
                <select
                  className={cn(selectCls, 'w-full')}
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
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('models:labelBaseUrl')}</label>
                <input
                  className={inputCls}
                  value={p.baseUrl || ''}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => onUpdateProvider({ baseUrl: e.target.value || undefined })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] text-muted-foreground">{t('models:labelApiKey')}</label>
                <div className="relative">
                  <input
                    className={cn(inputCls, 'pr-9')}
                    type={apiKeyVisible ? 'text' : 'password'}
                    value={p.apiKey || ''}
                    placeholder="$OPENAI_API_KEY"
                    onChange={(e) => onUpdateProvider({ apiKey: e.target.value || undefined })}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={onToggleApiKeyVisible}
                    aria-label={apiKeyVisible ? t('models:hideKeyLabel') : t('models:showKeyLabel')}
                  >
                    {apiKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(btnOutline, 'border-primary/30 text-primary')}
                disabled={fetching}
                onClick={onFetchRemote}
              >
                <CloudDownload className="mr-1 inline h-3.5 w-3.5" />
                {fetching ? t('models.fetching') : t('models.fetchModels')}
              </button>
              <button type="button" className={btnOutline} onClick={onManualAdd}>
                {t('models.manualAdd')}
              </button>
              <button
                type="button"
                className={cn(btnOutline, 'text-destructive hover:bg-destructive/10')}
                onClick={onRemoveProvider}
              >
                <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                {t('models:deleteBtn')}
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-muted-foreground">{t('models.remoteModels')}</div>
              <ModelCatalogPicker
                ids={remoteIds}
                localIds={new Set((p.models || []).map((m) => m.id))}
                loading={fetching}
                error={remoteError}
                onAdd={onAddModel}
                onAddAllNew={onAddAllNew}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t('models.localCount', { count: modelCount })}
                </span>
                <span className="text-[10px] text-muted-foreground/60">{t('models.expandToEdit')}</span>
              </div>
              {modelCount > 0 ? (
                <div className="space-y-2">
                  {(p.models || []).map((m) => {
                    const rowKey = `${pid}\0${m.id}`
                    return (
                      <ModelEntryEditor
                        key={m.id}
                        model={m}
                        expanded={expandedLocalModel[rowKey] === true}
                        onToggleExpand={() => onToggleLocalModel(rowKey)}
                        onChange={(patch) => onUpdateModel(m.id, patch)}
                        onRemove={() => onRemoveModel(m.id)}
                      />
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border/45 px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                  {t('models.localEmptyHint')}
                </p>
              )}
            </div>

            {hasOverrides && <p className="text-[10px] text-muted-foreground">{t('models.containsOverrides')}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}