import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AGENT_PURGE_MODES,
  defaultAgentPurgeConfig,
  detectPurgeStrategyPreset,
  normalizeAgentPurgeConfig,
  normalizeCustomTerms,
  PURGE_CIPHER_LEVELS,
  PURGE_THINKING_GUIDANCES,
  personaCopy,
  personaLanguage,
  sanitizePurgePersonaId,
  strategyForPreset,
  type AgentPurgeConfig,
  type AgentPurgeMode,
  type AgentPurgePersona,
  type LocalizedPersonaCopy,
  type PurgeCipherLevel,
  type PurgeHistoryMode,
  type PurgePrimerTurn,
  type PurgeStrategyOptions,
  type PurgeThinkingGuidance,
} from '@shared/agent-purge'
import { AlertTriangle, CloudDownload, FolderOpen, Plus, RotateCcw, Trash2 } from '@renderer/components/icons'
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
  const { t, i18n } = useTranslation()
  const lang = personaLanguage(i18n.language)
  const storeConfig = useAgentPurgeStore((s) => s.config)
  const localDir = useAgentPurgeStore((s) => s.localDir)

  const [baseConfig, setBaseConfig] = useState<AgentPurgeConfig>(() => storeConfig || defaultAgentPurgeConfig())
  const [draftConfig, setDraftConfig] = useState<AgentPurgeConfig>(() => storeConfig || defaultAgentPurgeConfig())
  const [selectedId, setSelectedId] = useState<string>(() => (storeConfig || defaultAgentPurgeConfig()).defaultPersonaId)
  const [customTermsRaw, setCustomTermsRaw] = useState<string>(() =>
    ((storeConfig || defaultAgentPurgeConfig()).customTerms ?? []).join('\n'),
  )
  const [githubRepo, setGithubRepo] = useState('ZiChuanLan/some-magic')
  const [importing, setImporting] = useState(false)

  const reloadFromMain = useCallback(async () => {
    await loadAgentPurgeState(true)
    const fresh = useAgentPurgeStore.getState().config
    setBaseConfig(fresh)
    setDraftConfig(fresh)
    setCustomTermsRaw((fresh.customTerms ?? []).join('\n'))
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
      setCustomTermsRaw((saved.customTerms ?? []).join('\n'))
    },
    discard: () => {
      setDraftConfig(baseConfig)
      setCustomTermsRaw((baseConfig.customTerms ?? []).join('\n'))
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

  const selectedCopy = selectedPersona ? personaCopy(selectedPersona, lang) : null
  const rawLoc = selectedPersona?.i18n?.[lang]
  const editName = selectedPersona ? (rawLoc?.name !== undefined ? rawLoc.name : selectedCopy!.name) : ''
  const editDescription = selectedPersona
    ? rawLoc?.description !== undefined
      ? rawLoc.description
      : selectedCopy!.description
    : ''
  const editBody = selectedPersona ? (rawLoc?.body !== undefined ? rawLoc.body : selectedCopy!.body) : ''
  const editPrimerTurns: PurgePrimerTurn[] = selectedPersona
    ? (rawLoc?.primerTurns ?? selectedCopy?.primerTurns ?? [])
    : []

  const updateDefaultStrategy = (patch: Partial<PurgeStrategyOptions>) => {
    setDraftConfig((prev) => {
      const nextHistoryMode = patch.historyMode ?? prev.defaultStrategy.historyMode
      const rawThinking = patch.thinkingGuidance ?? prev.defaultStrategy.thinkingGuidance
      const nextThinking: PurgeThinkingGuidance =
        nextHistoryMode === 'tunnel' && rawThinking !== 'suppress' ? 'tool_cot' : rawThinking
      return {
        ...prev,
        defaultStrategy: {
          ...prev.defaultStrategy,
          ...patch,
          thinkingGuidance: nextThinking,
          toolOutputRelay:
            nextHistoryMode === 'tunnel' || nextThinking === 'tool_cot'
              ? true
              : (patch.toolOutputRelay ?? prev.defaultStrategy.toolOutputRelay),
        },
      }
    })
  }

  const updateSelectedPersona = (patch: Partial<AgentPurgePersona>) => {
    if (!selectedPersona) return
    setDraftConfig((prev) => ({
      ...prev,
      personas: prev.personas.map((p) => {
        if (p.id !== selectedPersona.id) return p
        if (!p.i18n) {
          return { ...p, ...patch, updatedAt: Date.now() }
        }
        const cur = personaCopy(p, lang)
        const existingLoc = p.i18n[lang]
        const nextPrimer =
          patch.primerTurns !== undefined
            ? patch.primerTurns
            : (existingLoc?.primerTurns ?? cur.primerTurns)
        const nextLoc: LocalizedPersonaCopy = {
          name: patch.name !== undefined ? patch.name : (existingLoc?.name ?? cur.name),
          description:
            patch.description !== undefined
              ? patch.description
              : (existingLoc?.description ?? cur.description),
          body: patch.body !== undefined ? patch.body : (existingLoc?.body ?? cur.body),
          ...(nextPrimer !== undefined ? { primerTurns: nextPrimer } : {}),
        }
        return {
          ...p,
          ...(lang === 'zh' ? patch : {}),
          i18n: {
            ...p.i18n,
            [lang]: nextLoc,
          },
          updatedAt: Date.now(),
        }
      }),
    }))
  }

  const handleAddPrimerPair = () => {
    const appended: PurgePrimerTurn[] = [
      { role: 'user', content: t('settings:purge.primerDefaultUser') },
      { role: 'assistant', content: t('settings:purge.primerDefaultAssistant') },
    ]
    const next: PurgePrimerTurn[] = [...editPrimerTurns, ...appended].slice(0, 8)
    updateSelectedPersona({ primerTurns: next })
  }

  const handleUpdatePrimerTurn = (idx: number, patch: Partial<PurgePrimerTurn>) => {
    const next = editPrimerTurns.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    updateSelectedPersona({ primerTurns: next })
  }

  const handleRemovePrimerTurn = (idx: number) => {
    const next = editPrimerTurns.filter((_, i) => i !== idx)
    updateSelectedPersona({ primerTurns: next })
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
      body: t('settings:purge.newPersonaDefaultBody'),
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
      setCustomTermsRaw((saved.customTerms ?? []).join('\n'))
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
      setCustomTermsRaw((saved.customTerms ?? []).join('\n'))
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
      setCustomTermsRaw((saved.customTerms ?? []).join('\n'))
      toast.success(t('settings:purge.resetSuccess'))
    } catch {
      toast.error(t('common:saveFailed'))
    }
  }

  const defaultPreset = detectPurgeStrategyPreset(draftConfig.defaultStrategy)

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
            className={cn(selectCls, 'min-w-[14rem]')}
            value={draftConfig.defaultPersonaId}
            onChange={(e) =>
              setDraftConfig((prev) => ({ ...prev, defaultPersonaId: e.target.value }))
            }
          >
            {draftConfig.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {personaCopy(p, lang).name}
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
        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[248px_minmax(0,1fr)]">
          <div className="space-y-1 rounded-lg border border-border/50 bg-[var(--bg-2)]/35 p-1.5">
            {draftConfig.personas.map((p) => {
              const selected = p.id === selectedPersona?.id
              const isDefault = p.id === draftConfig.defaultPersonaId
              const copy = personaCopy(p, lang)
              const hasPrimer = Boolean(copy.primerTurns?.length)
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
                    <span className="truncate text-[13px] font-medium">{copy.name}</span>
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
                    {p.id} · {t('settings:purge.tokShort', { tokens: estimateTokens(copy.body) })}
                    {hasPrimer ? ` · ${t('composer:purge.primerBadge')}` : ''}
                  </span>
                </button>
              )
            })}
          </div>

          {selectedPersona ? (
            <div className="space-y-3.5 rounded-lg border border-border/50 bg-[var(--bg-2)]/20 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      {t('settings:purge.fieldName')}
                    </label>
                    <input
                      type="text"
                      className={inputCls}
                      value={editName}
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
                  value={editDescription}
                  onChange={(e) => updateSelectedPersona({ description: e.target.value })}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <label>{t('settings:purge.fieldBody')}</label>
                  <span className="font-mono tabular-nums">
                    {t('settings:purge.bodyStats', {
                      chars: editBody.length,
                      tokens: estimateTokens(editBody),
                    })}
                  </span>
                </div>
                <textarea
                  rows={12}
                  className={cn(textareaCls, 'min-h-[220px] font-mono text-[12.5px] leading-[1.55]')}
                  value={editBody}
                  onChange={(e) => updateSelectedPersona({ body: e.target.value })}
                />
              </div>

              <div className="space-y-2 border-t border-border/50 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-foreground">
                      {t('settings:purge.primerSectionTitle')}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t('settings:purge.primerSectionDesc')}
                    </div>
                  </div>
                  {editPrimerTurns.length < 8 ? (
                    <button
                      type="button"
                      onClick={handleAddPrimerPair}
                      className={cn(btnOutline, 'gap-1 text-xs')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{t('settings:purge.addPrimerPair')}</span>
                    </button>
                  ) : null}
                </div>

                {editPrimerTurns.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    {t('settings:purge.primerEmptyHint')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {editPrimerTurns.map((turn, idx) => (
                      <div
                        key={idx}
                        className="space-y-1.5 rounded-md border border-border/50 bg-background/60 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={turn.role}
                            onChange={(e) =>
                              handleUpdatePrimerTurn(idx, {
                                role: e.target.value as 'user' | 'assistant',
                              })
                            }
                            className="h-6 rounded border border-border/60 bg-background px-2 font-mono text-xs"
                          >
                            <option value="user">user</option>
                            <option value="assistant">assistant</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleRemovePrimerTurn(idx)}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={turn.content}
                          onChange={(e) => handleUpdatePrimerTurn(idx, { content: e.target.value })}
                          className={cn(textareaCls, 'font-mono text-xs leading-5')}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('settings:purge.strategySection')}
        description={t('settings:purge.strategySectionDesc')}
      >
        <SettingRow
          label={t('settings:purge.strategyPresetLabel')}
          description={t('settings:purge.strategyPresetDesc')}
        >
          <div className="flex flex-wrap gap-1.5">
            {(['standard', 'relay_push', 'tunnel'] as const).map((preset) => {
              const active = defaultPreset === preset
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      defaultStrategy: strategyForPreset(preset, prev.defaultStrategy),
                    }))
                  }
                  className={cn(
                    'settings-chip rounded-md border px-2.5 py-1.5 text-xs transition-all duration-motion-fast',
                    active
                      ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                      : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(`composer:purge.presets.${preset}`)}
                </button>
              )
            })}
          </div>
        </SettingRow>

        <SettingRow
          label={t('settings:purge.thinkingGuidanceLabel')}
          description={t(
            `composer:purge.thinkingHints.${draftConfig.defaultStrategy.thinkingGuidance}`,
          )}
        >
          <div className="flex flex-wrap gap-1.5">
            {PURGE_THINKING_GUIDANCES.map((g: PurgeThinkingGuidance) => {
              const active = draftConfig.defaultStrategy.thinkingGuidance === g
              const lockedByTunnel =
                draftConfig.defaultStrategy.historyMode === 'tunnel' &&
                g !== 'tool_cot' &&
                g !== 'suppress'
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={active}
                  disabled={lockedByTunnel}
                  onClick={() => updateDefaultStrategy({ thinkingGuidance: g })}
                  className={cn(
                    'settings-chip rounded-md border px-2.5 py-1.5 text-xs transition-all duration-motion-fast disabled:cursor-not-allowed disabled:opacity-45',
                    active
                      ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                      : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(`composer:purge.thinkingModes.${g}`)}
                </button>
              )
            })}
          </div>
        </SettingRow>

        <SettingRow
          label={t('settings:purge.primerEnabledLabel')}
          description={t('settings:purge.primerEnabledDesc')}
        >
          <input
            type="checkbox"
            checked={draftConfig.defaultStrategy.primerEnabled}
            onChange={(e) => updateDefaultStrategy({ primerEnabled: e.target.checked })}
            className="h-4 w-4 accent-[var(--brand)]"
          />
        </SettingRow>

        <SettingRow
          label={t('settings:purge.scrubHistoryLabel')}
          description={t('settings:purge.scrubHistoryDesc')}
        >
          <input
            type="checkbox"
            checked={draftConfig.defaultStrategy.scrubHistory}
            onChange={(e) => updateDefaultStrategy({ scrubHistory: e.target.checked })}
            className="h-4 w-4 accent-[var(--brand)]"
          />
        </SettingRow>

        <SettingRow
          label={t('settings:purge.historyModeLabel')}
          description={t('settings:purge.historyModeDesc')}
        >
          <select
            className={cn(selectCls, 'min-w-[13rem]')}
            value={draftConfig.defaultStrategy.historyMode}
            onChange={(e) =>
              updateDefaultStrategy({ historyMode: e.target.value as PurgeHistoryMode })
            }
          >
            <option value="none">{t('composer:purge.historyModes.none')}</option>
            <option value="push">{t('composer:purge.historyModes.push')}</option>
            <option value="tunnel">{t('composer:purge.historyModes.tunnel')}</option>
          </select>
        </SettingRow>

        <SettingRow
          label={t('settings:purge.toolOutputRelayLabel')}
          description={t('settings:purge.toolOutputRelayDesc')}
        >
          <input
            type="checkbox"
            disabled={
              draftConfig.defaultStrategy.historyMode === 'tunnel' ||
              draftConfig.defaultStrategy.thinkingGuidance === 'tool_cot'
            }
            checked={
              draftConfig.defaultStrategy.toolOutputRelay ||
              draftConfig.defaultStrategy.historyMode === 'tunnel' ||
              draftConfig.defaultStrategy.thinkingGuidance === 'tool_cot'
            }
            onChange={(e) => updateDefaultStrategy({ toolOutputRelay: e.target.checked })}
            className="h-4 w-4 accent-[var(--brand)] disabled:opacity-50"
          />
        </SettingRow>

        <SettingRow
          label={t('settings:purge.autoRetryLabel')}
          description={t('settings:purge.autoRetryDesc')}
        >
          <input
            type="checkbox"
            checked={draftConfig.defaultStrategy.autoRetry}
            onChange={(e) => updateDefaultStrategy({ autoRetry: e.target.checked })}
            className="h-4 w-4 accent-[var(--brand)]"
          />
        </SettingRow>

        <SettingRow
          label={t('settings:purge.fallbackModelLabel')}
          description={t('settings:purge.fallbackModelDesc')}
        >
          <input
            type="text"
            value={draftConfig.retryFallbackModel ?? ''}
            placeholder="provider/model-id"
            onChange={(e) =>
              setDraftConfig((prev) => ({
                ...prev,
                retryFallbackModel: e.target.value.trim() || undefined,
              }))
            }
            className={cn(inputCls, 'w-60 font-mono text-xs')}
          />
        </SettingRow>

        <SettingRow
          label={`${t('settings:purge.cipherLevelLabel')} · ${t('composer:purge.badges.notRecommendedDrift')}`}
          description={t('settings:purge.cipherLevelDesc')}
        >
          <div className="flex flex-wrap gap-1.5">
            {PURGE_CIPHER_LEVELS.map((lv: PurgeCipherLevel) => {
              const active = draftConfig.defaultStrategy.cipherLevel === lv
              return (
                <button
                  key={lv}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateDefaultStrategy({ cipherLevel: lv })}
                  className={cn(
                    'settings-chip rounded-md border px-2.5 py-1.5 text-xs transition-all duration-motion-fast',
                    active
                      ? lv === 'off'
                        ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                        : 'border-amber-500/45 bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300'
                      : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {t(`composer:purge.cipherLevels.${lv}`)}
                </button>
              )
            })}
          </div>
        </SettingRow>

        {draftConfig.defaultStrategy.cipherLevel !== 'off' && (
          <>
            <div className="my-2 flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  draftConfig.defaultStrategy.cipherLevel === 'full'
                    ? 'composer:purge.cipherFullDriftAndCacheWarn'
                    : 'composer:purge.cipherDriftWarn',
                )}
              </span>
            </div>

            <div className="pt-2">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <label>{t('settings:purge.customTermsLabel')}</label>
                <span className="text-[11px]">{t('settings:purge.customTermsSyntaxHint')}</span>
              </div>
              <textarea
                rows={4}
                value={customTermsRaw}
                placeholder={t('settings:purge.customTermsPlaceholder')}
                onChange={(e) => {
                  const rawVal = e.target.value
                  setCustomTermsRaw(rawVal)
                  const parsed = normalizeCustomTerms(rawVal.split(/\r?\n/))
                  setDraftConfig((prev) => ({ ...prev, customTerms: parsed }))
                }}
                className={cn(textareaCls, 'font-mono text-xs leading-5')}
              />
            </div>
          </>
        )}
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
