import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight,
  CloudDownload,
  Eye,
  EyeOff,
  Layers,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { cn } from '@renderer/lib/utils'
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
import { ModelCatalogPicker } from '@renderer/features/settings/model-catalog-picker'
import { ModelEntryEditor, type LocalModelEntry } from '@renderer/features/settings/model-entry-editor'
import { ManualModelAddDialog } from '@renderer/features/settings/manual-model-add-dialog'

const API_OPTS = [
  { v: 'openai-completions', l: 'OpenAI Chat Completions' },
  { v: 'openai-responses', l: 'OpenAI Responses' },
  { v: 'anthropic-messages', l: 'Anthropic Messages' },
  { v: 'google-generative-ai', l: 'Google Generative AI' },
] as const

const inputCls =
  'settings-field-focus w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-mono'
const selectCls =
  'settings-field-focus rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]'
const btnOutline =
  'settings-chip rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] disabled:opacity-40'
const btnPrimary =
  'settings-chip rounded-md bg-primary px-2.5 py-1.5 text-[12px] text-primary-foreground disabled:opacity-40'

function cloneConfig(c: PiModelsConfigPayload): PiModelsConfigPayload {
  return JSON.parse(JSON.stringify(c)) as PiModelsConfigPayload
}

function configEqual(a: PiModelsConfigPayload | null, b: PiModelsConfigPayload | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

function maskApiKey(key?: string): string {
  if (!key) return '未配置'
  if (key.startsWith('$')) return key
  if (key.startsWith('!')) return '!command'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-2)}`
}

function ProviderAvatar({ preset, label }: { preset?: ProviderPreset; label: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white shadow-sm transition-transform duration-motion-fast ease-motion-ease',
        preset?.accentClass ?? 'bg-muted-foreground/40',
      )}
      title={label}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  )
}

export function ModelsSettingsPanel() {
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
  const [confirmState, setConfirmState] = useState<
    | { title: string; message: string; destructive?: boolean; onConfirm: () => void }
    | null
  >(null)

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
    } catch (e: any) {
      toast.error(e?.message || '加载 models.json 失败')
    } finally {
      setLoading(false)
    }
  }, [])

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
    label: '模型配置',
    isDirty: () => !configEqual(draft, baseline),
    commit: async () => {
      if (!draft || configEqual(draft, baseline)) return
      const res = await ipcClient.invoke('pi.models.set', { config: draft })
      if (!res?.ok) throw new Error(res?.error || '保存失败')
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
    toast.success(`已添加「${preset.label}」→ ${key}`)
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
      const models =
        prev.models?.length ? prev.models : templ.models?.length ? templ.models : []
      c.providers[providerId] = {
        ...templ,
        apiKey: prev.apiKey || templ.apiKey,
        models,
        name: templ.name || prev.name,
      }
    })
    toast.success(`已套用 ${preset.label} 模板`)
  }

  const fetchRemoteCatalog = async (providerId: string) => {
    const p = draft?.providers[providerId]
    if (!p?.baseUrl) {
      toast.error('先填写 baseUrl')
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
          [providerId]: { ids: [], error: res?.error || '拉取失败' },
        }))
        toast.error(res?.error || '拉取失败')
        return
      }
      const ids = res.ids || []
      setRemoteCatalog((prev) => ({ ...prev, [providerId]: { ids } }))
      toast.success(`已加载 ${ids.length} 个远端模型`)
    } finally {
      setFetching(null)
    }
  }

  const defaultModelEntry = (id: string): LocalModelEntry => {
    const guessReasoning = /^(o\d|gpt-5|claude-opus|deepseek-reasoner|think)/i.test(id)
    const guessVision = /(vision|gpt-4o|gemini|claude-3|image)/i.test(id)
    return {
      id,
      name: id,
      reasoning: guessReasoning || undefined,
      input: guessVision ? ['text', 'image'] : ['text'],
      ...(guessReasoning ? { thinkingLevelMap: { xhigh: 'xhigh', max: 'max' } } : {}),
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
    toast.success(`已添加 ${modelId}`)
  }

  const addAllNewToLocal = (providerId: string) => {
    const catalog = remoteCatalog[providerId]?.ids || []
    const existing = new Set((draft?.providers[providerId].models || []).map((m) => m.id))
    const toAdd = catalog.filter((id) => !existing.has(id))
    if (!toAdd.length) {
      toast.message('没有可添加的新模型')
      return
    }
    patchDraft((c) => {
      const prov = c.providers[providerId]
      prov.models = [...(prov.models || []), ...toAdd.map((id) => defaultModelEntry(id))]
    })
    toast.success(`已添加 ${toAdd.length} 个模型`)
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
    toast.success(`已添加 ${ids.length} 个模型`)
  }

  if (loading && !draft) {
    return <p className="text-[13px] text-muted-foreground">加载 models.json…</p>
  }

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="模型供应商"
        description={`编辑 ${filePath || '~/.pi/agent/models.json'}，与终端 pi 一致。保存后重载模型列表。`}
        action={
          <button type="button" className={btnOutline} onClick={() => void load()}>
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
            重新加载
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
            已从 models.json 自动修正 {loadWarnings.length} 处
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
            已配置 <strong className="text-foreground">{providerIds.length}</strong> 个供应商
          </span>
        </div>
        <div className="relative">
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setAddMenuOpen((o) => !o)}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            添加供应商
          </button>
          {addMenuOpen && (
            <>
              <button
                type="button"
                className="backdrop-motion fixed inset-0 z-40 cursor-default bg-black/20"
                aria-label="关闭"
                onClick={() => setAddMenuOpen(false)}
              />
              <div className="popover-motion absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border/80 bg-popover p-2 shadow-lg">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  选择模板
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
                          键名 {preset.defaultKey}
                          {preset.starterModels?.length ? ` · 含 ${preset.starterModels.length} 个模型` : ' · 需自行拉取模型'}
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
          <p className="mt-3 text-[13px] font-medium text-foreground/90">暂无供应商</p>
          <p className="mt-1 text-[12px] text-muted-foreground">点「添加供应商」选模板或自建中转。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {providerIds.map((pid, cardIndex) => {
            const p = draft!.providers[pid]
            const preset = guessPresetForProvider(pid, p)
            const displayName = p.name || preset?.label || pid
            const open = expanded[pid] === true
            const modelCount = p.models?.length ?? 0
            const hasOverrides = p.modelOverrides && Object.keys(p.modelOverrides).length > 0
            return (
              <div
                key={pid}
                className={cn(
                  'settings-provider-card ui-enter overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-sm',
                  cardIndex < 5 && `stagger-${cardIndex + 1}`,
                )}
                style={cardIndex >= 5 ? { animationDelay: `${Math.min(cardIndex, 8) * 35}ms` } : undefined}
              >
                <button
                  type="button"
                  className="settings-provider-header interactive-row flex w-full items-center gap-3 px-3 py-3 text-left"
                  onClick={() => setExpanded((e) => ({ ...e, [pid]: !open }))}
                >
                  <ChevronRight
                    className="settings-chevron h-4 w-4 shrink-0 text-muted-foreground"
                    data-open={open}
                  />
                  <ProviderAvatar preset={preset} label={displayName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{displayName}</span>
                      <span className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {pid}
                      </span>
                      {preset && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {preset.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {p.baseUrl || '未设置 baseUrl'}
                      <span className="mx-1.5 text-border">·</span>
                      {API_OPTS.find((o) => o.v === p.api)?.l || p.api || 'api 未设'}
                      <span className="mx-1.5 text-border">·</span>
                      {maskApiKey(p.apiKey)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-medium tabular-nums">{modelCount}</div>
                    <div className="text-[10px] text-muted-foreground">模型</div>
                  </div>
                </button>

                <div className="settings-expand-grid" data-open={open}>
                  <div className="settings-expand-inner">
                    <div className="settings-expand-content space-y-4 border-t border-border/40 bg-background/30 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">换模板</span>
                      {PROVIDER_PRESETS.slice(0, 6).map((pr) => (
                        <button
                          key={pr.id}
                          type="button"
                          className="settings-chip rounded-full border border-border/60 px-2 py-0.5 text-[10px]"
                          title={pr.tagline}
                          onClick={() =>
                            setConfirmState({
                              title: '套用模板',
                              message: `用 ${pr.label} 模板覆盖连接配置？\n保留当前 Key 与已添加模型。`,
                              onConfirm: () => {
                                setConfirmState(null)
                                applyPresetToExisting(pid, pr)
                              },
                            })
                          }
                        >
                          {pr.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">名称</label>
                        <input
                          className={inputCls}
                          value={p.name || ''}
                          onChange={(e) => updateProvider(pid, { name: e.target.value || undefined })}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted-foreground">接口</label>
                        <select
                          className={cn(selectCls, 'w-full')}
                          value={p.api || 'openai-completions'}
                          onChange={(e) =>
                            updateProvider(pid, { api: e.target.value as PiModelsProviderConfig['api'] })
                          }
                        >
                          {API_OPTS.map((o) => (
                            <option key={o.v} value={o.v}>
                              {o.l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] text-muted-foreground">Base URL</label>
                        <input
                          className={inputCls}
                          value={p.baseUrl || ''}
                          placeholder="https://api.example.com/v1"
                          onChange={(e) => updateProvider(pid, { baseUrl: e.target.value || undefined })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] text-muted-foreground">API Key</label>
                        <div className="relative">
                          <input
                            className={cn(inputCls, 'pr-9')}
                            type={apiKeyVisible[pid] ? 'text' : 'password'}
                            value={p.apiKey || ''}
                            placeholder="$OPENAI_API_KEY"
                            onChange={(e) => updateProvider(pid, { apiKey: e.target.value || undefined })}
                          />
                          <button
                            type="button"
                            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => setApiKeyVisible((s) => ({ ...s, [pid]: !s[pid] }))}
                            aria-label={apiKeyVisible[pid] ? '隐藏 Key' : '显示 Key'}
                          >
                            {apiKeyVisible[pid] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={cn(btnOutline, 'border-primary/30 text-primary')}
                        disabled={fetching === pid}
                        onClick={() => void fetchRemoteCatalog(pid)}
                      >
                        <CloudDownload className="mr-1 inline h-3.5 w-3.5" />
                        {fetching === pid ? '拉取中…' : '拉取模型'}
                      </button>
                      <button
                        type="button"
                        className={btnOutline}
                        onClick={() => setManualAddProviderId(pid)}
                      >
                        手动添加
                      </button>
                      <button
                        type="button"
                        className={cn(btnOutline, 'text-destructive hover:bg-destructive/10')}
                        onClick={() =>
                          setConfirmState({
                            title: '删除供应商',
                            message: `删除供应商「${displayName}」（${pid}）？`,
                            destructive: true,
                            onConfirm: () => {
                              setConfirmState(null)
                              removeProvider(pid)
                            },
                          })
                        }
                      >
                        <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>

                    <div className="space-y-2">
                      <div className="text-[11px] font-medium text-muted-foreground">远端模型</div>
                      <ModelCatalogPicker
                        ids={remoteCatalog[pid]?.ids || []}
                        localIds={new Set((p.models || []).map((m) => m.id))}
                        loading={fetching === pid}
                        error={remoteCatalog[pid]?.error}
                        onAdd={(id) => addModelToLocal(pid, id)}
                        onAddAllNew={() => addAllNewToLocal(pid)}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          本地（{modelCount}）
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">展开改参数</span>
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
                                onToggleExpand={() =>
                                  setExpandedLocalModel((e) => ({ ...e, [rowKey]: !e[rowKey] }))
                                }
                                onChange={(patch) => updateModelEntry(pid, m.id, patch)}
                                onRemove={() => removeModel(pid, m.id)}
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-border/45 px-3 py-4 text-center text-[11px] text-muted-foreground/70">
                          在远端列表点 + 添加，或手动添加
                        </p>
                      )}
                    </div>

                    {hasOverrides && (
                      <p className="text-[10px] text-muted-foreground">
                        含 modelOverrides，随配置一并保存。
                      </p>
                    )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
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