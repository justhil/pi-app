import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Layers, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc-client'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import type { PiModelsConfigPayload, PiModelsProviderConfig } from '@shared/ipc-contract'
import {
  PROVIDER_PRESETS,
  allocateProviderKey,
  clonePresetConfig,
  guessPresetForProvider,
  type ProviderPreset,
} from '@renderer/features/settings/model-provider-presets'
import { ManualModelAddDialog } from '@renderer/features/settings/manual-model-add-dialog'
import type { LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import { btnOutline, btnPrimary, cloneConfig, configEqual, defaultModelEntry, ProviderAvatar } from './models-settings-shared'
import { ModelsProviderCard } from './models-provider-card'

export function ModelsSettingsPanel() {
  const { t } = useTranslation()
  const [filePath, setFilePath] = useState('')
  const [baseline, setBaseline] = useState<PiModelsConfigPayload | null>(null)
  const [draft, setDraft] = useState<PiModelsConfigPayload | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [loadWarnings, setLoadWarnings] = useState<string[]>([])
  const [manualAddProviderId, setManualAddProviderId] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [fetching, setFetching] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [remoteCatalog, setRemoteCatalog] = useState<Record<string, { ids: string[]; error?: string }>>({})
  const [expandedLocalModel, setExpandedLocalModel] = useState<Record<string, boolean>>({})
  const [apiKeyVisible, setApiKeyVisible] = useState<Record<string, boolean>>({})
  const [confirmState, setConfirmState] = useState<{
    title: string
    message: string
    destructive?: boolean
    onConfirm: () => void
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await ipcClient.invoke('pi.models.get', {})
      setFilePath(res?.path || '')
      setParseError(res?.parseError || null)
      setSchemaError(res?.schemaError || null)
      setLoadWarnings(res?.warnings?.length ? res.warnings : [])
      const cfg = res?.config ?? { providers: {} }
      setBaseline(cloneConfig(cfg))
      setDraft(cloneConfig(cfg))
      const keys = Object.keys(cfg.providers || {})
      setExpanded((prev) => {
        const next = { ...prev }
        for (const k of keys) if (next[k] === undefined) next[k] = keys.length <= 3
        return next
      })
    } catch (e: unknown) {
      toast.error((e instanceof Error ? e.message : String(e)) || t('models:loadFailedToast'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

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
    label: t('models:modelConfig'),
    isDirty: () => !configEqual(draft, baseline),
    commit: async () => {
      if (!draft || configEqual(draft, baseline)) return
      const res = await ipcClient.invoke('pi.models.set', { config: draft })
      if (!res?.ok) throw new Error(res?.error || t('models:saveFailed'))
      await load()
    },
    discard: () => {
      if (baseline) setDraft(cloneConfig(baseline))
      notifySettingsDirtyChanged()
    },
  })

  const providerIds = useMemo(
    () => Object.keys(draft?.providers || {}).sort((a, b) => a.localeCompare(b)),
    [draft],
  )

  const addFromPreset = (preset: ProviderPreset) => {
    const key = allocateProviderKey(draft?.providers || {}, preset.defaultKey)
    patchDraft((c) => {
      c.providers[key] = clonePresetConfig(preset)
    })
    setExpanded((e) => ({ ...e, [key]: true }))
    setAddMenuOpen(false)
    toast.success(t('models:addedProviderToast', { label: preset.label, key }))
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
      const templ = clonePresetConfig(preset)
      const models = prev.models?.length ? prev.models : templ.models?.length ? templ.models : []
      c.providers[providerId] = {
        ...templ,
        apiKey: prev.apiKey || templ.apiKey,
        models,
        name: templ.name || prev.name,
      }
    })
    toast.success(t('models:applyTemplateToast', { label: preset.label }))
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

  const addModelToLocal = (providerId: string, modelId: string) => {
    if ((draft?.providers[providerId].models || []).some((m) => m.id === modelId)) return
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = [...(prov.models || []), defaultModelEntry(modelId)]
    })
    const key = `${providerId}\0${modelId}`
    setExpandedLocalModel((e) => ({ ...e, [key]: true }))
    toast.success(t('models:addedModelToast', { id: modelId }))
  }

  const addAllNewToLocal = (providerId: string) => {
    const catalog = remoteCatalog[providerId]?.ids || []
    const existing = new Set((draft?.providers[providerId].models || []).map((m) => m.id))
    const toAdd = catalog.filter((id) => !existing.has(id))
    if (!toAdd.length) {
      toast.message(t('models.noNewModels'))
      return
    }
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = [...(prov.models || []), ...toAdd.map((id) => defaultModelEntry(id))]
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
    for (const modelId of ids) {
      if ((draft?.providers[providerId].models || []).some((m) => m.id === modelId)) continue
      addModelToLocal(providerId, modelId)
    }
    setManualAddProviderId(null)
    if (ids.length === 1) return
    toast.success(t('models.addedModels', { count: ids.length }))
  }

  if (loading && !draft) {
    return <p className="text-[13px] text-muted-foreground">{t('models:loadingModels')}</p>
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t('models:providerLabel')}
        description={t('models.description', { path: filePath || '~/.pi/agent/models.json' })}
        action={
          <button type="button" className={btnOutline} onClick={() => void load()}>
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
            {t('models.reload')}
          </button>
        }
      />

      {(parseError || schemaError) && (
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
          {parseError && <div>{parseError}</div>}
          {schemaError && <div>{schemaError}</div>}
        </div>
      )}

      {loadWarnings.length > 0 && !parseError && (
        <details className="ui-enter rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground/80">
            {t('models:autoFixedCount', { count: loadWarnings.length })}
          </summary>
          <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4">
            {loadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Layers className="h-4 w-4" />
          <span>
            {t('models.configured')} <strong className="text-foreground">{providerIds.length}</strong>{' '}
            {t('models.providers')}
          </span>
        </div>
        <div className="relative">
          <button type="button" className={btnPrimary} onClick={() => setAddMenuOpen((o) => !o)}>
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            {t('models:addProviderBtn')}
          </button>
          {addMenuOpen && (
            <>
              <button
                type="button"
                className="backdrop-motion fixed inset-0 z-40 cursor-default bg-black/20"
                aria-label={t('models:close')}
                onClick={() => setAddMenuOpen(false)}
              />
              <div className="popover-motion absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border/80 bg-popover p-2 shadow-lg">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {t('models:selectTemplate')}
                </div>
                <div className="max-h-[min(420px,60vh)] overflow-y-auto">
                  {PROVIDER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="settings-preset-menu-item flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left"
                      onClick={() => addFromPreset(preset)}
                    >
                      <ProviderAvatar preset={preset} label={preset.label} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">{preset.label}</div>
                        <div className="text-[11px] text-muted-foreground">{preset.tagline}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
                          {t('models:keyName')} {preset.defaultKey}
                          {preset.starterModels?.length
                            ? ` · ${t('models.containsModels', { count: preset.starterModels.length })}`
                            : ` · ${t('models.needsFetch')}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {providerIds.length === 0 ? (
        <div className="ui-enter rounded-xl border border-dashed border-border/60 bg-muted/15 px-6 py-10 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/35" />
          <p className="mt-3 text-[13px] font-medium text-foreground/90">{t('models:noProviders')}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">{t('models:noProvidersHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {providerIds.map((pid, cardIndex) => (
            <ModelsProviderCard
              key={pid}
              pid={pid}
              cardIndex={cardIndex}
              config={draft!}
              open={expanded[pid] === true}
              onToggleOpen={() => setExpanded((e) => ({ ...e, [pid]: !e[pid] }))}
              fetching={fetching === pid}
              remoteIds={remoteCatalog[pid]?.ids || []}
              remoteError={remoteCatalog[pid]?.error}
              apiKeyVisible={!!apiKeyVisible[pid]}
              onToggleApiKeyVisible={() => setApiKeyVisible((s) => ({ ...s, [pid]: !s[pid] }))}
              expandedLocalModel={expandedLocalModel}
              onToggleLocalModel={(rowKey) =>
                setExpandedLocalModel((e) => ({ ...e, [rowKey]: !e[rowKey] }))
              }
              onApplyPreset={(pr) =>
                setConfirmState({
                  title: t('models:applyTemplateTitle'),
                  message: t('models.applyTemplateConfirm', { label: pr.label }),
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
            />
          ))}
        </div>
      )}

      {manualAddProviderId && draft?.providers[manualAddProviderId] && (
        <ManualModelAddDialog
          open
          providerLabel={
            draft.providers[manualAddProviderId].name ||
            guessPresetForProvider(manualAddProviderId, draft.providers[manualAddProviderId])?.label ||
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