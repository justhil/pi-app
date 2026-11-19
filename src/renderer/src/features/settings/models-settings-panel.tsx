import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Search, Sparkles } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import type { PiModelsConfigPayload, PiModelsProviderConfig, ModelInfo } from '@shared/ipc-contract'
import {
  PROVIDER_PRESETS,
  allocateProviderKey,
  clonePresetConfig,
  guessPresetForProvider,
  presetLabel,
  presetTagline,
  type ProviderPreset,
  type ProviderPresetCategory,
} from '@renderer/features/settings/model-provider-presets'
import { ManualModelAddDialog } from '@renderer/features/settings/manual-model-add-dialog'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import {
  refreshUpstreamCatalog,
  useUpstreamModelCatalogStore,
} from '@renderer/features/settings/upstream-model-catalog'
import { btnOutline, btnPrimary, cloneConfig, configEqual, defaultModelEntry, ProviderAvatar } from './models-settings-shared'
import { ModelsProviderCard } from './models-provider-card'
import { ModelsSdkProviderSection } from './models-sdk-provider-section'
import { saveModelsConfigDraft } from './save-models-config'
import { ModelDefaultsSection } from './model-defaults-section'
import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { cn } from '@renderer/lib/utils'

type PresetFilterCategory = 'all' | ProviderPresetCategory

export function ModelsSettingsPanel() {
  const { t } = useTranslation('settings')
  const [filePath, setFilePath] = useState('')
  const [baseline, setBaseline] = useState<PiModelsConfigPayload | null>(null)
  const [draft, setDraft] = useState<PiModelsConfigPayload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [loadWarnings, setLoadWarnings] = useState<string[]>([])
  const [manualAddProviderId, setManualAddProviderId] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [presetQuery, setPresetQuery] = useState('')
  const [presetCategory, setPresetCategory] = useState<PresetFilterCategory>('all')
  const presetSearchRef = useRef<HTMLInputElement>(null)
  const [remoteCatalog, setRemoteCatalog] = useState<Record<string, { ids: string[]; error?: string }>>({})
  const [settingsModels, setSettingsModels] = useState<ModelInfo[]>([])
  const [expandedLocalModel, setExpandedLocalModel] = useState<Record<string, boolean>>({})
  const [apiKeyVisible, setApiKeyVisible] = useState<Record<string, boolean>>({})
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => void
  } | null>(null)

  const catalogSnapshot = useUpstreamModelCatalogStore((s) => s.snapshot)
  const catalogLoading = useUpstreamModelCatalogStore((s) => s.loading)

  useEffect(() => {
    if (!addMenuOpen) {
      setPresetQuery('')
      setPresetCategory('all')
      return
    }
    const timer = window.setTimeout(() => presetSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [addMenuOpen])

  const load = useCallback(async () => {
    const res = await ipcClient.invoke('pi.models.get', {})
    setFilePath(res?.path || '')
    setParseError(res?.parseError || null)
    setSchemaError(res?.schemaError || null)
    setLoadWarnings(res?.warnings?.length ? res.warnings : [])
    setSaveError(null)
    const snapshot = await ipcClient.invoke('model.list', { scope: 'settings' }).catch(() => ({ models: [] }))
    setSettingsModels(snapshot?.models || [])
    const cfg = res?.config ?? { providers: {} }
    setBaseline(cloneConfig(cfg))
    setDraft(cloneConfig(cfg))
    const keys = Object.keys(cfg.providers || {}).sort((a, b) => a.localeCompare(b))
    setExpanded((prev) => {
      const next = { ...prev }
      // Expand only the first provider on initial load so multi-provider pages stay scannable.
      keys.forEach((k, idx) => {
        if (next[k] === undefined) next[k] = idx === 0
      })
      return next
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    void load()
      .catch((e: unknown) => {
        toast.error((e instanceof Error ? e.message : String(e)) || t('models.loadFailedToast'))
      })
      .finally(() => setLoading(false))
    return onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed') void load()
    })
  }, [load, t])

  const patchDraft = useCallback((fn: (c: PiModelsConfigPayload) => void) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = cloneConfig(prev)
      fn(next)
      notifySettingsDirtyChanged()
      return next
    })
  }, [])

  useSettingsDirtySlice({
    id: 'pi-models',
    label: t('models.modelConfig'),
    isDirty: () => !configEqual(draft, baseline),
    commit: async () => {
      if (!draft || configEqual(draft, baseline)) return
      try {
        await saveModelsConfigDraft(draft, {
          setConfig: (config) => ipcClient.invoke('pi.models.set', { config }),
          onWritten: invalidateAvailableModels,
          reload: load,
        })
        prefetchAvailableModels()
      } catch (error) {
        const message =
          error instanceof Error && error.message !== 'SAVE_FAILED'
            ? error.message
            : t('models.saveFailed')
        setSaveError(message)
        throw new Error(message)
      }
    },
    discard: () => {
      if (baseline) setDraft(cloneConfig(baseline))
      notifySettingsDirtyChanged()
    },
  })

  const sdkModelsByProvider = useMemo(() => {
    const byProvider: Record<string, ModelInfo[]> = {}
    const seen = new Map<string, Set<string>>()
    for (const model of settingsModels) {
      if (!model.provider || !model.id) continue
      const ids = seen.get(model.provider) ?? new Set<string>()
      if (ids.has(model.id)) continue
      ids.add(model.id)
      seen.set(model.provider, ids)
      ;(byProvider[model.provider] ??= []).push(model)
    }
    for (const models of Object.values(byProvider)) {
      models.sort((a, b) => a.id.localeCompare(b.id))
    }
    return byProvider
  }, [settingsModels])

  const sdkProviderIds = useMemo(
    () => Object.keys(sdkModelsByProvider).sort((a, b) => a.localeCompare(b)),
    [sdkModelsByProvider],
  )

  const providerIds = useMemo(
    () => Object.keys(draft?.providers || {}).sort((a, b) => a.localeCompare(b)),
    [draft],
  )

  const filteredPresets = useMemo(() => {
    const needle = presetQuery.trim().toLowerCase()
    return PROVIDER_PRESETS.filter((preset) => {
      if (presetCategory !== 'all' && preset.category !== presetCategory) return false
      if (!needle) return true
      const label = presetLabel(preset, t).toLowerCase()
      const tagline = presetTagline(preset, t).toLowerCase()
      const hay = [
        preset.id,
        preset.defaultKey,
        label,
        tagline,
        preset.config.baseUrl || '',
        ...(preset.aliases || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [presetCategory, presetQuery, t])

  const addFromPreset = (preset: ProviderPreset) => {
    const key = allocateProviderKey(draft?.providers || {}, preset.defaultKey)
    patchDraft((c) => {
      c.providers[key] = clonePresetConfig(preset, t, useUpstreamModelCatalogStore.getState().snapshot)
    })
    setExpanded((prev) => {
      const next: Record<string, boolean> = {}
      for (const k of Object.keys(prev)) next[k] = false
      next[key] = true
      return next
    })
    setAddMenuOpen(false)
    toast.success(t('models.addedProviderToast', { label: presetLabel(preset, t), key }))
  }

  const removeProvider = (id: string) => {
    patchDraft((c) => {
      delete c.providers[id]
    })
  }

  const updateProvider = (id: string, patch: Partial<PiModelsProviderConfig>) => {
    patchDraft((c) => {
      c.providers[id] = { ...c.providers[id], ...patch }
    })
  }

  const applyPresetToExisting = (providerId: string, preset: ProviderPreset) => {
    patchDraft((c) => {
      const prev = c.providers[providerId]
      const templ = clonePresetConfig(preset, t, useUpstreamModelCatalogStore.getState().snapshot)
      const models = prev.models?.length ? prev.models : templ.models?.length ? templ.models : []
      c.providers[providerId] = {
        ...templ,
        apiKey: prev.apiKey || templ.apiKey,
        models,
        name: templ.name || prev.name,
      }
    })
    toast.success(t('models.applyTemplateToast', { label: presetLabel(preset, t) }))
  }

  const fetchRemoteCatalog = async (providerId: string) => {
    const p = draft?.providers[providerId]
    if (!p?.baseUrl) {
      toast.error(t('models.fetchNeedBaseUrl'))
      return
    }
    setFetching(providerId)
    setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids: prev[providerId]?.ids || [] } }))
    try {
      const res = await ipcClient.invoke('pi.models.fetch', {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        authHeader: p.authHeader,
      })
      if (!res?.ok) {
        setRemoteCatalog((prev) => ({
          ...prev,
          [providerId]: { ids: [], error: res?.error || t('models.fetchFailed') },
        }))
        toast.error(res?.error || t('models.fetchFailed'))
        return
      }
      const ids = res.ids || []
      setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids } }))
      toast.success(t('models.loadedModels', { count: ids.length }))
    } finally {
      setFetching(null)
    }
  }

  const addModelToLocal = (providerId: string, modelId: string, expandAdded = false) => {
    const prov = draft?.providers[providerId]
    if (!prov || (prov.models || []).some((m) => m.id === modelId)) return
    const snap = useUpstreamModelCatalogStore.getState().snapshot
    const built = defaultModelEntry(modelId, {
      catalog: snap,
      providerId,
      baseUrl: prov.baseUrl,
    })
    patchDraft((c) => {
      const target = c.providers[providerId]
      target.models = [...(target.models || []), built]
    })
    // Keep newly added models compact if full specs were auto-filled; expand only if manual/bare.
    if (expandAdded || built.contextWindow == null) {
      const key = `${providerId}\0${modelId}`
      setExpandedLocalModel((e) => ({ ...e, [key]: true }))
    }
    toast.success(t('models.addedModelToast', { id: modelId }))
  }

  const addAllNewToLocal = (providerId: string) => {
    const prov = draft?.providers[providerId]
    if (!prov) return
    const catalog = remoteCatalog[providerId]?.ids || []
    const existing = new Set((prov.models || []).map((m) => m.id))
    const toAdd = catalog.filter((id) => !existing.has(id))
    if (!toAdd.length) {
      toast.message(t('models.noNewModels'))
      return
    }
    const snap = useUpstreamModelCatalogStore.getState().snapshot
    patchDraft((c) => {
      const target = c.providers[providerId]
      target.models = [
        ...(target.models || []),
        ...toAdd.map((id) =>
          defaultModelEntry(id, { catalog: snap, providerId, baseUrl: target.baseUrl }),
        ),
      ]
    })
    toast.success(t('models.addedModels', { count: toAdd.length }))
  }

  const removeModel = (providerId: string, modelId: string) => {
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = (prov.models || []).filter((m) => m.id !== modelId)
    })
  }

  const updateModelEntry = (providerId: string, modelId: string, patch: Partial<LocalModelEntry>) => {
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = (prov.models || []).map((m) => (m.id === modelId ? { ...m, ...patch } : m))
    })
  }

  const confirmManualModels = async (providerId: string, ids: string[]) => {
    const prov = draft?.providers[providerId]
    if (!prov) return
    const snap = useUpstreamModelCatalogStore.getState().snapshot
    const existing = new Set((prov.models || []).map((m) => m.id))
    const toAdd = ids.filter((id) => !existing.has(id))
    if (toAdd.length > 0) {
      patchDraft((c) => {
        const target = c.providers[providerId]
        target.models = [
          ...(target.models || []),
          ...toAdd.map((id) =>
            defaultModelEntry(id, { catalog: snap, providerId, baseUrl: target.baseUrl }),
          ),
        ]
      })
    }
    setManualAddProviderId(null)
    if (toAdd.length === 1) {
      toast.success(t('models.addedModelToast', { id: toAdd[0] }))
    } else if (toAdd.length > 1) {
      toast.success(t('models.addedModels', { count: toAdd.length }))
    }
  }

  const handleSyncCatalog = async () => {
    const snap = await refreshUpstreamCatalog()
    if (snap && snap.modelCount > 0 && !snap.error) {
      toast.success(t('models.catalogSyncedToast', { count: snap.modelCount }))
    } else if (snap?.error) {
      toast.error(t('models.catalogSyncFailedToast', { error: snap.error }))
    }
  }

  const focusProvider = (targetPid: string) => {
    setExpanded((prev) => {
      const currentlyOnly = prev[targetPid] && Object.entries(prev).every(([k, v]) => k === targetPid || !v)
      if (currentlyOnly) return prev
      const next: Record<string, boolean> = {}
      for (const k of providerIds) next[k] = k === targetPid
      return next
    })
  }

  if (loading && !draft) {
    return <p className="text-base text-muted-foreground">{t('models.loadingModels')}</p>
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('models.providerLabel')}
        description={t('models.description', { path: filePath || '~/.pi/agent/models.json' })}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="sync-models-dev-btn"
              disabled={catalogLoading}
              title={t('models.catalogSyncTooltip')}
              className={cn(btnOutline, 'inline-flex items-center gap-1 text-[12px]')}
              onClick={() => void handleSyncCatalog()}
            >
              <Sparkles className={cn('h-3 w-3 text-primary', catalogLoading && 'animate-pulse')} strokeWidth={2} />
              <span>
                {catalogLoading
                  ? t('models.catalogSyncing')
                  : catalogSnapshot?.modelCount
                    ? t('models.catalogSyncedBadge', { count: catalogSnapshot.modelCount })
                    : t('models.catalogSyncBtn')}
              </span>
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => void load().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))}
            >
              <RefreshCw className="mr-1 inline h-3 w-3" strokeWidth={2} />
              {t('models.reload')}
            </button>
          </div>
        }
      />

      <ModelDefaultsSection />

      {(parseError || schemaError || saveError) && (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 whitespace-pre-wrap px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {parseError && <div>{parseError}</div>}
          {schemaError && <div>{schemaError}</div>}
          {saveError && <div>{saveError}</div>}
        </div>
      )}

      {loadWarnings.length > 0 && !parseError && (
        <details className="ui-enter rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground/80">
            {t('models.autoFixedCount', { count: loadWarnings.length })}
          </summary>
          <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
            {loadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="space-y-2.5" data-testid="user-provider-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 px-1">
            <h3 className="text-[13.5px] font-semibold leading-5 text-foreground">{t('models.userProvidersTitle')}</h3>
            <p className="mt-0.5 text-[12.5px] leading-[1.6] text-foreground-secondary">
              {t('models.userProvidersDescription', { count: providerIds.length })}
            </p>
          </div>
          <div className="relative">
            <button type="button" className={btnPrimary} onClick={() => setAddMenuOpen((o) => !o)}>
              <Plus className="mr-1 inline h-3 w-3" strokeWidth={2} />
              {t('models.addProviderBtn')}
            </button>
            {addMenuOpen && (
              <>
                <button
                  type="button"
                  className="backdrop-motion fixed inset-0 z-40 cursor-default bg-black/20"
                  aria-label={t('models.close')}
                  onClick={() => setAddMenuOpen(false)}
                />
                <div className="popover-motion absolute right-0 z-50 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-border/80 bg-popover p-2.5 shadow-xl">
                  <div className="relative mb-2">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <input
                      ref={presetSearchRef}
                      className="settings-field h-[30px] w-full rounded-lg border border-border/70 bg-background pl-8 pr-2.5 text-[12.5px] outline-none focus:border-primary/60"
                      placeholder={t('models.presetSearchPlaceholder')}
                      value={presetQuery}
                      onChange={(e) => setPresetQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setAddMenuOpen(false)
                        if (e.key === 'Enter' && filteredPresets.length === 1) {
                          addFromPreset(filteredPresets[0])
                        }
                      }}
                    />
                  </div>
                  <div className="mb-2 flex items-center gap-1">
                    {(['all', 'official', 'relay', 'local'] as const).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPresetCategory(cat)}
                        className={cn(
                          'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                          presetCategory === cat
                            ? 'bg-primary/12 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {t(`models.presetCategory.${cat}`)}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-[min(360px,56vh)] overflow-y-auto">
                    {filteredPresets.length === 0 ? (
                      <p className="py-5 text-center text-[12px] text-muted-foreground">
                        {t('models.noMatchModel')}
                      </p>
                    ) : (
                      filteredPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="settings-preset-menu-item flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left"
                          onClick={() => addFromPreset(preset)}
                        >
                          <ProviderAvatar preset={preset} label={presetLabel(preset, t)} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium leading-tight">{presetLabel(preset, t)}</div>
                            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{presetTagline(preset, t)}</div>
                            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground/65">
                              {t('models.keyName', { key: preset.defaultKey })}
                              {preset.starterModels?.length
                                ? ` · ${t('models.containsModels', { count: preset.starterModels.length })}`
                                : ` · ${t('models.needsFetch')}`}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {providerIds.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5" role="navigation" aria-label={t('models.userProvidersTitle')}>
            {providerIds.map((pid) => {
              const p = draft!.providers[pid]
              const label = p.name || presetLabel(guessPresetForProvider(pid, p), t) || pid
              const active = expanded[pid] === true
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => focusProvider(pid)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                    active
                      ? 'border-primary/45 bg-primary/10 font-medium text-foreground'
                      : 'border-border/60 bg-background/60 text-foreground-secondary hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  <span className="max-w-[9rem] truncate">{label}</span>
                  <span className="font-mono text-[10.5px] tabular-nums opacity-70">{p.models?.length ?? 0}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {providerIds.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/50 px-3 py-3 text-sm text-muted-foreground">
            {t('models.userProvidersEmpty')}
          </p>
        ) : (
          <div className="space-y-2">
            {providerIds.map((pid, cardIndex) => {
              const catalogIds = Array.from(
                new Set(
                  (remoteCatalog[pid]?.ids || []).filter(
                    (id) => !(draft?.providers[pid].models || []).some((model) => model.id === id),
                  ),
                ),
              )
              return (
                <ModelsProviderCard
                  key={pid}
                  pid={pid}
                  cardIndex={cardIndex}
                  config={draft!}
                  open={expanded[pid] === true}
                  onToggleOpen={() => setExpanded((e) => ({ ...e, [pid]: !e[pid] }))}
                  fetching={fetching === pid}
                  remoteIds={catalogIds}
                  remoteError={remoteCatalog[pid]?.error}
                  apiKeyVisible={!!apiKeyVisible[pid]}
                  onToggleApiKeyVisible={() => setApiKeyVisible((s) => ({ ...s, [pid]: !s[pid] }))}
                  expandedLocalModel={expandedLocalModel}
                  onToggleLocalModel={(rowKey) =>
                    setExpandedLocalModel((e) => ({ ...e, [rowKey]: !e[rowKey] }))
                  }
                  onApplyPreset={(pr) =>
                    setConfirmState({
                      title: t('models.applyTemplateTitle'),
                      message: t('models.applyTemplateConfirm', { label: presetLabel(pr, t) }),
                      onConfirm: () => {
                        setConfirmState(null)
                        applyPresetToExisting(pid, pr)
                      },
                    })
                  }
                  onUpdateProvider={(patch) => updateProvider(pid, patch)}
                  onFetchRemote={() => void fetchRemoteCatalog(pid)}
                  onManualAdd={() => setManualAddProviderId(pid)}
                  onRemoveProvider={() =>
                    setConfirmState({
                      title: t('models.deleteProvider'),
                      message: t('models.deleteProviderConfirm', {
                        name: draft!.providers[pid].name || pid,
                        id: pid,
                      }),
                      destructive: true,
                      onConfirm: () => {
                        setConfirmState(null)
                        removeProvider(pid)
                      },
                    })
                  }
                  onAddModel={(id) => addModelToLocal(pid, id)}
                  onAddAllNew={() => addAllNewToLocal(pid)}
                  onUpdateModel={(modelId, patch) => updateModelEntry(pid, modelId, patch)}
                  onRemoveModel={(modelId) => removeModel(pid, modelId)}
                  sdkModels={settingsModels}
                />
              )
            })}
          </div>
        )}
      </section>

      <ModelsSdkProviderSection providerIds={sdkProviderIds} modelsByProvider={sdkModelsByProvider} />

      {manualAddProviderId && draft?.providers[manualAddProviderId] && (
        <ManualModelAddDialog
          open
          providerId={manualAddProviderId}
          baseUrl={draft.providers[manualAddProviderId].baseUrl}
          providerLabel={
            draft.providers[manualAddProviderId].name ||
            presetLabel(guessPresetForProvider(manualAddProviderId, draft.providers[manualAddProviderId]), t) ||
            manualAddProviderId
          }
          existingIds={new Set((draft.providers[manualAddProviderId].models || []).map((m) => m.id))}
          onConfirm={(ids) => confirmManualModels(manualAddProviderId, ids)}
          onCancel={() => setManualAddProviderId(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          open
          title={confirmState.title}
          message={confirmState.message}
          destructive={confirmState.destructive}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  )
}
