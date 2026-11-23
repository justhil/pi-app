import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Plus, RefreshCw, Sparkles } from '@renderer/components/icons'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import type { PiModelsConfigPayload, PiModelsProviderConfig, ModelInfo } from '@shared/ipc-contract'
import {
  clonePresetConfig,
  isBuiltInSdkProviderId,
  presetLabel,
  validateProviderKey,
  type ProviderPreset,
} from '@renderer/features/settings/model-provider-presets'
import { ManualModelAddDialog } from '@renderer/features/settings/manual-model-add-dialog'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import {
  refreshUpstreamCatalog,
  useUpstreamModelCatalogStore,
} from '@renderer/features/settings/upstream-model-catalog'
import { btnOutline, btnPrimary, cloneConfig, configEqual, defaultModelEntry } from './models-settings-shared'
import { ModelsProviderCard } from './models-provider-card'
import { ModelsSdkProviderSection } from './models-sdk-provider-section'
import { ProviderAddDialog } from './provider-add-dialog'
import { saveModelsConfigDraft } from './save-models-config'
import { ModelDefaultsSection } from './model-defaults-section'
import { invalidateAvailableModels, prefetchAvailableModels } from '@renderer/lib/available-models-cache'
import { cn } from '@renderer/lib/utils'

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
  const [addDialogOpen, setAddDialogOpen] = useState(false)
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

  const sdkManagedProviderIds = useMemo(() => {
    const set = new Set<string>()
    for (const [provId, list] of Object.entries(sdkModelsByProvider)) {
      const configuredIds = new Set(
        (baseline?.providers?.[provId]?.models ?? []).map((m) => m.id),
      )
      // Only a true built-in/extension provider supplies models beyond what models.json itself declared.
      if (list.some((m) => !configuredIds.has(m.id))) {
        set.add(provId)
      }
    }
    return [...set]
  }, [baseline, sdkModelsByProvider])

  const providerIds = useMemo(
    () => Object.keys(draft?.providers || {}).sort((a, b) => a.localeCompare(b)),
    [draft],
  )

  const handleConfirmAddProvider = (key: string, config: PiModelsProviderConfig) => {
    patchDraft((c) => {
      c.providers[key] = config
    })
    setExpanded((prev) => {
      const next: Record<string, boolean> = {}
      for (const k of Object.keys(prev)) next[k] = false
      next[key] = true
      return next
    })
    setAddDialogOpen(false)
    toast.success(t('models.addedProviderToast', { label: config.name || key, key }))
  }

  const removeProvider = (id: string) => {
    patchDraft((c) => {
      delete c.providers[id]
    })
  }

  const renameProvider = (oldId: string, nextRaw: string): boolean => {
    if (!draft) return false
    const check = validateProviderKey(nextRaw, draft.providers, oldId)
    if (!check.ok) {
      toast.error(
        check.reason === 'duplicate'
          ? t('models.providerKeyDuplicate', { key: nextRaw.trim() })
          : t('models.providerKeyInvalid'),
      )
      return false
    }
    const nextId = check.key
    if (nextId === oldId) return true

    patchDraft((c) => {
      const entry = c.providers[oldId]
      if (!entry) return
      delete c.providers[oldId]
      c.providers[nextId] = entry
    })
    setExpanded((prev) => {
      const next = { ...prev, [nextId]: prev[oldId] ?? true }
      delete next[oldId]
      return next
    })
    setRemoteCatalog((prev) => {
      if (!(oldId in prev)) return prev
      const next = { ...prev, [nextId]: prev[oldId] }
      delete next[oldId]
      return next
    })
    setApiKeyVisible((prev) => {
      if (!(oldId in prev)) return prev
      const next = { ...prev, [nextId]: prev[oldId] }
      delete next[oldId]
      return next
    })
    toast.success(t('models.renamedProviderToast', { from: oldId, to: nextId }))
    return true
  }

  const updateProvider = (id: string, patch: Partial<PiModelsProviderConfig>) => {
    patchDraft((c) => {
      const next = { ...c.providers[id], ...patch }
      if (!next.name) delete next.name
      if (!next.baseUrl) delete next.baseUrl
      if (!next.apiKey) delete next.apiKey
      c.providers[id] = next
    })
  }

  const applyPresetToExisting = (providerId: string, preset: ProviderPreset) => {
    patchDraft((c) => {
      const prev = c.providers[providerId]
      const templ = clonePresetConfig(preset)
      c.providers[providerId] = {
        ...prev,
        api: templ.api || prev.api,
        baseUrl: templ.baseUrl || prev.baseUrl,
        ...(templ.compat ? { compat: templ.compat } : {}),
        apiKey: prev.apiKey || templ.apiKey,
        models: prev.models ?? [],
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
          <button
            type="button"
            data-testid="open-add-provider-btn"
            className={btnPrimary}
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1 inline h-3 w-3" strokeWidth={2} />
            {t('models.addProviderBtn')}
          </button>
        </div>

        {providerIds.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5" role="navigation" aria-label={t('models.userProvidersTitle')}>
            {providerIds.map((pid) => {
              const p = draft!.providers[pid]
              const label = p.name?.trim() || pid
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
                  isBuiltInCollision={isBuiltInSdkProviderId(pid, sdkManagedProviderIds)}
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
                  onRenameProvider={(nextId) => renameProvider(pid, nextId)}
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

      <ProviderAddDialog
        open={addDialogOpen}
        existingProviders={draft?.providers || {}}
        runtimeSdkProviderIds={sdkManagedProviderIds}
        onConfirm={handleConfirmAddProvider}
        onClose={() => setAddDialogOpen(false)}
      />

      {manualAddProviderId && draft?.providers[manualAddProviderId] && (
        <ManualModelAddDialog
          open
          providerId={manualAddProviderId}
          baseUrl={draft.providers[manualAddProviderId].baseUrl}
          providerLabel={draft.providers[manualAddProviderId].name?.trim() || manualAddProviderId}
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
