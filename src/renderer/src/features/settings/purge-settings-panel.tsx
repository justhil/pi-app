import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AGENT_PURGE_MODES,
  defaultAgentPurgeConfig,
  normalizeAgentPurgeConfig,
  sanitizePurgePersonaId,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
} from '@shared/agent-purge'
import { CloudDownload, FolderOpen, Plus, RotateCcw, Trash2 } from '@renderer/components/icons'
import {
  applySavedAgentPurgeConfig,
  loadAgentPurgeState,
  useAgentPurgeStore,
} from '@renderer/lib/agent-purge-store'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { btnOutline, inputCls, selectCls, textareaCls } from './settings-controls'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { SettingsPageHeader } from './settings-shell'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.2))
}

export function PurgeSettingsPanel() {
  const { t } = useTranslation()
  const storeConfig = useAgentPurgeStore((s) => s.config)
  const localDir = useAgentPurgeStore((s) => s.localDir)

  const [baseConfig, setBaseConfig] = useState<AgentPurgeConfig>(() => storeConfig || defaultAgentPurgeConfig())
  const [draftConfig, setDraftConfig] = useState<AgentPurgeConfig>(() => storeConfig || defaultAgentPurgeConfig())
  const [selectedId, setSelectedId] = useState<string>(() => (storeConfig || defaultAgentPurgeConfig()).defaultPersonaId)
  const [githubRepo, setGithubRepo] = useState('ZiChuanLan/some-magic')
  const [importing, setImporting] = useState(false)

  const reloadFromMain = useCallback(async () => {
    await loadAgentPurgeState(true)
    const fresh = useAgentPurgeStore.getState().config
    setBaseConfig(fresh)
    setDraftConfig(fresh)
    setSelectedId((prev) =>
      fresh.personas.some((p) => p.id === prev) ? prev : fresh.defaultPersonaId,
    )
  }, [])

  useEffect(() => {
    void reloadFromMain()
  }, [reloadFromMain])

  const isDirty = useMemo(
    () => JSON.stringify(draftConfig) !== JSON.stringify(baseConfig),
    [draftConfig, baseConfig],
  )

  useSettingsDirtySlice({
    id: 'purge',
    label: t('settings:nav.purge'),
    isDirty: () => isDirty,
    commit: async () => {
      const res = (await ipcClient.invoke('purge.saveConfig', { config: draftConfig })) as {
        ok?: boolean
        config?: unknown
      }
      const saved = applySavedAgentPurgeConfig(res?.config ?? draftConfig)
      setBaseConfig(saved)
      setDraftConfig(saved)
    },
    discard: () => {
      setDraftConfig(baseConfig)
      if (!baseConfig.personas.some((p) => p.id === selectedId)) {
        setSelectedId(baseConfig.defaultPersonaId)
      }
    },
  })

  const selectedPersona = useMemo(
    () =>
      draftConfig.personas.find((p) => p.id === selectedId) ??
      draftConfig.personas[0] ??
      null,
    [draftConfig.personas, selectedId],
  )

  const updateSelectedPersona = (patch: Partial<AgentPurgePersona>) => {
    if (!selectedPersona) return
    setDraftConfig((prev) => ({
      ...prev,
      personas: prev.personas.map((p) =>
        p.id === selectedPersona.id ? { ...p, ...patch, updatedAt: Date.now() } : p,
      ),
    }))
  }

  const handleAddPersona = () => {
    const existingIds = new Set(draftConfig.personas.map((p) => p.id))
    let idx = draftConfig.personas.length + 1
    let newId = sanitizePurgePersonaId(`custom-${idx}`)
    while (existingIds.has(newId)) {
      idx++
      newId = sanitizePurgePersonaId(`custom-${idx}`)
    }
    const created: AgentPurgePersona = {
      id: newId,
      name: t('settings:purge.newPersonaDefaultName', { index: idx }),
      description: '',
      body: '# 自定义会话提示词\n\n在这里编写需要注入新对话的系统提示词正文。',
      order: 50 + idx,
      updatedAt: Date.now(),
    }
    setDraftConfig((prev) => ({
      ...prev,
      personas: [...prev.personas, created],
    }))
    setSelectedId(newId)
  }

  const handleDeletePersona = (id: string) => {
    const target = draftConfig.personas.find((p) => p.id === id)
    if (!target || target.builtin || draftConfig.personas.length <= 1) return
    setDraftConfig((prev) => {
      const remaining = prev.personas.filter((p) => p.id !== id)
      const nextDefault =
        prev.defaultPersonaId === id ? remaining[0]?.id ?? 'konata' : prev.defaultPersonaId
      return normalizeAgentPurgeConfig({
        ...prev,
        defaultPersonaId: nextDefault,
        personas: remaining,
      })
    })
    if (selectedId === id) {
      const fallback = draftConfig.personas.find((p) => p.id !== id)
      if (fallback) setSelectedId(fallback.id)
    }
  }

  const handleImportLocal = async (chooseFolder = false) => {
    setImporting(true)
    try {
      let dir: string | undefined
      if (chooseFolder) {
        const picked = (await ipcClient.invoke('dialog:openDirectory')) as string | null
        if (!picked) {
          setImporting(false)
          return
        }
        dir = picked
      }
      const res = (await ipcClient.invoke('purge.importLocal', dir ? { dir } : {})) as {
        count?: number
        config?: unknown
      }
      const saved = applySavedAgentPurgeConfig(res?.config)
      setBaseConfig(saved)
      setDraftConfig(saved)
      toast.success(t('settings:purge.importedToast', { count: res?.count ?? 0 }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings:purge.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const handleImportGithub = async () => {
    const src = githubRepo.trim()
    if (!src) return
    setImporting(true)
    try {
      const res = (await ipcClient.invoke('purge.importGithub', { source: src })) as {
        count?: number
        config?: unknown
      }
      const saved = applySavedAgentPurgeConfig(res?.config)
      setBaseConfig(saved)
      setDraftConfig(saved)
      toast.success(t('settings:purge.importedToast', { count: res?.count ?? 0 }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings:purge.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const handleResetBuiltins = async () => {
    try {
      const res = (await ipcClient.invoke('purge.resetBuiltins')) as { config?: unknown }
      const saved = applySavedAgentPurgeConfig(res?.config)
      setBaseConfig(saved)
      setDraftConfig(saved)
      toast.success(t('settings:purge.resetSuccess'))
    } catch {
      toast.error(t('common:saveFailed'))
    }
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={t('settings:purge.title')}
        description={t('settings:purge.description')}
      />

      <SettingsSection
        title={t('settings:purge.defaultsSection')}
        description={t('settings:purge.defaultsSectionDesc')}
      >
        <SettingRow
          label={t('settings:purge.defaultPersona')}
          description={t('settings:purge.defaultPersonaDesc')}
          settingKey="defaultPersonaId"
        >
          <select
            className={cn(selectCls, 'min-w-[13rem]')}
            value={draftConfig.defaultPersonaId}
            onChange={(e) =>
              setDraftConfig((prev) => ({ ...prev, defaultPersonaId: e.target.value }))
            }
          >
            {draftConfig.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label={t('settings:purge.defaultMode')}
          description={t(`settings:purge.modeDesc.${draftConfig.defaultMode}`)}
          settingKey="defaultMode"
        >
          <div className="flex flex-wrap gap-1.5">
            {AGENT_PURGE_MODES.map((m: AgentPurgeMode) => {
              const active = draftConfig.defaultMode === m
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDraftConfig((prev) => ({ ...prev, defaultMode: m }))}
                  className={cn(
                    'settings-chip rounded-md border px-2.5 py-1.5 text-xs transition-all duration-motion-fast',
                    active
                      ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                      : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(`settings:purge.modes.${m}`)}
                </button>
              )
            })}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings:purge.librarySection')}
        description={t('settings:purge.librarySectionDesc')}
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleResetBuiltins}
              className={cn(btnOutline, 'gap-1.5 text-xs')}
              title={t('settings:purge.resetBuiltinsHint')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t('settings:purge.resetBuiltins')}</span>
            </button>
            <button
              type="button"
              onClick={handleAddPersona}
              className={cn(btnOutline, 'gap-1.5 text-xs')}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t('settings:purge.newPersona')}</span>
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-1 rounded-lg border border-border/50 bg-[var(--bg-2)]/35 p-1.5">
            {draftConfig.personas.map((p) => {
              const selected = p.id === selectedPersona?.id
              const isDefault = p.id === draftConfig.defaultPersonaId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    selected
                      ? 'bg-[var(--bg-active)] text-foreground'
                      : 'text-foreground-secondary hover:bg-[var(--bg-hover)] hover:text-foreground',
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-[13px] font-medium">{p.name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {isDefault ? (
                        <span className="settings-badge text-[10px]">
                          {t('settings:purge.defaultBadge')}
                        </span>
                      ) : null}
                      {p.builtin ? (
                        <span className="rounded bg-border/40 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {t('settings:purge.builtinBadge')}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="truncate font-mono text-[11px] text-muted-foreground/75">
                    {p.id} · ~{estimateTokens(p.body)} tok
                  </span>
                </button>
              )
            })}
          </div>

          {selectedPersona ? (
            <div className="space-y-3 rounded-lg border border-border/50 bg-[var(--bg-2)]/20 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      {t('settings:purge.fieldName')}
                    </label>
                    <input
                      type="text"
                      className={inputCls}
                      value={selectedPersona.name}
                      onChange={(e) => updateSelectedPersona({ name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      {t('settings:purge.fieldId')}
                    </label>
                    <input
                      type="text"
                      disabled
                      className={cn(inputCls, 'font-mono opacity-65')}
                      value={selectedPersona.id}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 self-end">
                  {draftConfig.defaultPersonaId !== selectedPersona.id ? (
                    <button
                      type="button"
                      className={cn(btnOutline, 'text-xs')}
                      onClick={() =>
                        setDraftConfig((prev) => ({
                          ...prev,
                          defaultPersonaId: selectedPersona.id,
                        }))
                      }
                    >
                      {t('settings:purge.setAsDefault')}
                    </button>
                  ) : null}
                  {!selectedPersona.builtin && draftConfig.personas.length > 1 ? (
                    <button
                      type="button"
                      className={cn(btnOutline, 'text-xs text-destructive hover:text-destructive')}
                      onClick={() => handleDeletePersona(selectedPersona.id)}
                      title={t('settings:purge.deletePersona')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('settings:purge.fieldDescription')}
                </label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder={t('settings:purge.fieldDescriptionPlaceholder')}
                  value={selectedPersona.description}
                  onChange={(e) => updateSelectedPersona({ description: e.target.value })}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <label>{t('settings:purge.fieldBody')}</label>
                  <span className="font-mono tabular-nums">
                    {selectedPersona.body.length} chars · ~{estimateTokens(selectedPersona.body)} tokens
                  </span>
                </div>
                <textarea
                  rows={14}
                  className={cn(textareaCls, 'min-h-[280px] font-mono text-[12.5px] leading-[1.55]')}
                  value={selectedPersona.body}
                  onChange={(e) => updateSelectedPersona({ body: e.target.value })}
                />
              </div>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings:purge.importSection')}
        description={t('settings:purge.importSectionDesc')}
      >
        <SettingRow
          label={t('settings:purge.importLocal')}
          description={
            localDir
              ? t('settings:purge.importLocalDescWithDir', { dir: localDir })
              : t('settings:purge.importLocalDesc')
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportLocal(false)}
              className={cn(btnOutline, 'gap-1.5 text-xs')}
            >
              <CloudDownload className="h-3.5 w-3.5" />
              <span>{t('settings:purge.syncAgentPurgeHome')}</span>
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImportLocal(true)}
              className={cn(btnOutline, 'gap-1.5 text-xs')}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>{t('settings:purge.pickFolder')}</span>
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label={t('settings:purge.importGithub')}
          description={t('settings:purge.importGithubDesc')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="ZiChuanLan/some-magic"
              className={cn(inputCls, 'w-56 font-mono text-xs')}
            />
            <button
              type="button"
              disabled={importing || !githubRepo.trim()}
              onClick={() => void handleImportGithub()}
              className={cn(btnOutline, 'gap-1.5 text-xs')}
            >
              <CloudDownload className="h-3.5 w-3.5" />
              <span>{t('settings:purge.pullGithub')}</span>
            </button>
          </div>
        </SettingRow>
      </SettingsSection>
    </div>
  )
}
