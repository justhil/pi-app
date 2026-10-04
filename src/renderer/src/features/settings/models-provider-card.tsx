import { useTranslation } from 'react-i18next'
import { ChevronRight, CloudDownload, Eye, EyeOff, Trash2 } from '@renderer/components/icons'
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
  btnDanger,
  btnOutline,
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
  const { t } = useTranslation('settings')
  const p = config.providers[pid]
  const preset = guessPresetForProvider(pid, p)
  const displayName = p.name || preset?.label || pid
  const modelCount = p.models?.length ?? 0
  const hasOverrides = p.modelOverrides && Object.keys(p.modelOverrides).length > 0

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
        className="settings-provider-header interactive-row flex w-full items-center gap-3 px-3 py-3 text-left"
        onClick={onToggleOpen}
      >
        <ChevronRight className="settings-chevron h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} data-open={open} />
        <ProviderAvatar preset={preset} label={displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-medium text-foreground">{displayName}</span>
            {pid !== displayName ? <span className="truncate font-mono text-[11.5px] text-foreground-secondary">{pid}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-foreground-secondary">
            {p.baseUrl || t('models.notSetBaseUrl')}
            <span className="mx-1.5 text-border">·</span>
            {API_OPTS.find((o) => o.v === p.api)?.l || p.api || t('models.apiNotSetLabel')}
            <span className="mx-1.5 text-border">·</span>
            {maskApiKey(p.apiKey)}
          </div>
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-foreground-secondary">{t('models.modelCount', { count: modelCount })}</span>
      </button>

      <div className="settings-expand-grid" data-open={open}>
        <div className="settings-expand-inner">
          <div className="settings-expand-content space-y-5 px-4 py-4">

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center justify-between text-[11.5px] text-foreground-secondary">
                  {t('models.labelName')}
                  <select
                    aria-label={t('models.changeTemplate')}
                    className="max-w-[10rem] bg-transparent text-right text-[11.5px] text-foreground-secondary outline-none hover:text-foreground"
                    value=""
                    onChange={(e) => {
                      const pr = PROVIDER_PRESETS.find((x) => x.id === e.target.value)
                      if (pr) onApplyPreset(pr)
                    }}
                  >
                    <option value="">{t('models.fillFromTemplate')}</option>
                    {PROVIDER_PRESETS.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.label}
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
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelBaseUrl')}</label>
                <input
                  className={cn(inputCls, fieldCls)}
                  value={p.baseUrl || ''}
                  placeholder="https://api.example.com/v1"
                  onChange={(e) => onUpdateProvider({ baseUrl: e.target.value || undefined })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11.5px] text-foreground-secondary">{t('models.labelApiKey')}</label>
                <div className="relative">
                  <input
                    className={cn(inputCls, fieldCls, 'pr-9')}
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

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(btnOutline, 'border-primary/30 text-primary')}
                disabled={fetching}
                onClick={onFetchRemote}
              >
                <CloudDownload className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {fetching ? t('models.fetching') : t('models.fetchModels')}
              </button>
              <button type="button" className={btnOutline} onClick={onManualAdd}>
                {t('models.manualAdd')}
              </button>
              <button
                type="button"
                className={cn(btnDanger, 'ml-auto')}
                onClick={onRemoveProvider}
              >
                <Trash2 className="mr-1 inline h-3 w-3" strokeWidth={2} />
                {t('models.deleteBtn')}
              </button>
            </div>

            <div className="space-y-2">
              <h4 className="text-[12px] font-medium text-foreground">{t('models.remoteModels')}</h4>
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
                <h4 className="text-[12px] font-medium text-foreground">{t('models.localCount', { count: modelCount })}</h4>
              </div>
              {modelCount > 0 ? (
                <div className="space-y-1.5">
                  {(p.models || []).map((m) => {
                    const rowKey = `${pid}\0${m.id}`
                    const rowExpanded = expandedLocalModel[rowKey] === true
                    return (
                      <div key={m.id} className={rowExpanded ? undefined : 'settings-virtual-row settings-virtual-row-sm'}>
                        <ModelEntryEditor
                          model={m}
                          expanded={rowExpanded}
                          onToggleExpand={() => onToggleLocalModel(rowKey)}
                          onChange={(patch) => onUpdateModel(m.id, patch)}
                          onRemove={() => onRemoveModel(m.id)}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-[var(--border-base)] px-3 py-4 text-center text-[12px] text-foreground-secondary">
                  {t('models.localEmptyHint')}
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