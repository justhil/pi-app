import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from '@renderer/components/icons'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import {
  ensureAvailableModels,
  peekAvailableModels,
  subscribeAvailableModels,
} from '@renderer/lib/available-models-cache'
import { loadModelThinkingBindings } from '@renderer/lib/model-thinking-bindings'
import { useSettingsDirtySlice } from './use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from './settings-dirty-registry'
import { SettingRow, SettingsSection } from './settings-page-shared'
import { btnOutline, inputCls, selectCls } from './settings-controls'

export const THINKING_LEVEL_KEYS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type ModelDefaults = {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  enabledModels?: string[]
  modelThinkingLevels: Record<string, string>
}

const FIELDS = ['defaultProvider', 'defaultModel', 'defaultThinkingLevel', 'enabledModels', 'modelThinkingLevels'] as const

function fromSettings(raw: Record<string, unknown> | null | undefined): ModelDefaults {
  const bindings = raw?.modelThinkingLevels
  return {
    defaultProvider: typeof raw?.defaultProvider === 'string' ? raw.defaultProvider : undefined,
    defaultModel: typeof raw?.defaultModel === 'string' ? raw.defaultModel : undefined,
    defaultThinkingLevel: typeof raw?.defaultThinkingLevel === 'string' ? raw.defaultThinkingLevel : undefined,
    enabledModels: Array.isArray(raw?.enabledModels) ? (raw.enabledModels as unknown[]).map(String) : undefined,
    modelThinkingLevels:
      bindings && typeof bindings === 'object' && !Array.isArray(bindings)
        ? Object.fromEntries(
            Object.entries(bindings as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
  }
}

/** Only keys that changed, so this section never rewrites settings another page just saved. */
export function changedModelDefaults(draft: ModelDefaults, baseline: ModelDefaults): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (JSON.stringify(draft[key] ?? null) !== JSON.stringify(baseline[key] ?? null)) patch[key] = draft[key]
  }
  // IPC drops `undefined`; `null` tells the Worker to clear the scope.
  if ('enabledModels' in patch && patch.enabledModels === undefined) patch.enabledModels = null
  if ('defaultModel' in patch || 'defaultProvider' in patch) {
    patch.defaultProvider = draft.defaultProvider
    patch.defaultModel = draft.defaultModel
  }
  return patch
}

/**
 * Settings → Models: default model, default thinking level (incl. `max`), the model cycling scope
 * and per-model thinking bindings (pi `modelThinkingLevels`, applied when a session switches to a
 * bound model; shared with terminal pi ≥ 0.84).
 */
export function ModelDefaultsSection() {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<ModelDefaults | null>(null)
  const [draft, setDraft] = useState<ModelDefaults | null>(null)
  const [models, setModels] = useState(() => peekAvailableModels())
  const [newModel, setNewModel] = useState('')
  const [newLevel, setNewLevel] = useState('high')
  const [scopeText, setScopeText] = useState('')
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  draftRef.current = draft
  baselineRef.current = baseline

  const load = useCallback(async () => {
    const res = await ipcClient.invoke('pi.settings.get').catch(() => null)
    const snapshot = fromSettings((res?.settings as Record<string, unknown> | null) ?? null)
    setBaseline(snapshot)
    setDraft(snapshot)
    setScopeText((snapshot.enabledModels ?? []).join(', '))
  }, [])

  useEffect(() => {
    void load()
    void ensureAvailableModels().catch(() => {})
    return subscribeAvailableModels(setModels)
  }, [load])

  const patch = (next: Partial<ModelDefaults>) => {
    setDraft((previous) => (previous ? { ...previous, ...next } : previous))
    notifySettingsDirtyChanged()
  }

  useSettingsDirtySlice({
    id: 'model-defaults',
    label: t('settings:modelDefaults.title'),
    isDirty: () =>
      !!draftRef.current &&
      !!baselineRef.current &&
      Object.keys(changedModelDefaults(draftRef.current, baselineRef.current)).length > 0,
    commit: async () => {
      if (!draftRef.current || !baselineRef.current) return
      const changes = changedModelDefaults(draftRef.current, baselineRef.current)
      if (Object.keys(changes).length === 0) return
      const res = await ipcClient.invoke('pi.settings.set', { patch: changes })
      if (res?.ok === false) throw new Error(String(res.error || t('common:saveFailed')))
      await load()
      await loadModelThinkingBindings(true)
      await refreshComposerRunDisplay()
    },
    discard: () => {
      void load()
    },
  })

  const modelKeys = useMemo(
    () =>
      [...models]
        .map((model) => `${model.provider}/${model.id}`)
        .sort((a, b) => a.localeCompare(b)),
    [models],
  )
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const key of modelKeys) {
      const provider = key.slice(0, key.indexOf('/'))
      const list = map.get(provider)
      if (list) list.push(key)
      else map.set(provider, [key])
    }
    return [...map.entries()]
  }, [modelKeys])

  if (!draft) {
    return (
      <SettingsSection title={t('settings:modelDefaults.title')} description={t('settings:modelDefaults.description')}>
        <div className="h-24 animate-pulse" />
      </SettingsSection>
    )
  }

  const currentModelKey = draft.defaultProvider && draft.defaultModel ? `${draft.defaultProvider}/${draft.defaultModel}` : ''
  const bindings = Object.entries(draft.modelThinkingLevels).sort(([a], [b]) => a.localeCompare(b))
  const unboundKeys = modelKeys.filter((key) => !(key in draft.modelThinkingLevels))
  const levelLabel = (level: string) => `${t(`settings:modelDefaults.level.${level}`)} · ${level}`

  const addBinding = () => {
    if (!newModel) return
    patch({ modelThinkingLevels: { ...draft.modelThinkingLevels, [newModel]: newLevel } })
    setNewModel('')
  }

  return (
    <SettingsSection title={t('settings:modelDefaults.title')} description={t('settings:modelDefaults.description')}>
      <SettingRow label={t('settings:modelDefaults.defaultModel')} description={t('settings:modelDefaults.defaultModelDesc')}>
        <select
          className={cn(selectCls, 'min-w-[min(300px,70vw)]')}
          aria-label={t('settings:modelDefaults.defaultModel')}
          value={currentModelKey}
          onChange={(event) => {
            const key = event.target.value
            const slash = key.indexOf('/')
            patch(
              slash < 0
                ? { defaultProvider: undefined, defaultModel: undefined }
                : { defaultProvider: key.slice(0, slash), defaultModel: key.slice(slash + 1) },
            )
          }}
        >
          <option value="">{t('settings:modelDefaults.automatic')}</option>
          {/* Configured but not usable right now (no key / login): still show what is set. */}
          {currentModelKey && modelKeys.length > 0 && !modelKeys.includes(currentModelKey) ? (
            <option value={currentModelKey}>
              {currentModelKey} · {t('settings:modelDefaults.bindingMissing')}
            </option>
          ) : null}
          {modelsByProvider.map(([provider, keys]) => (
            <optgroup key={provider} label={provider}>
              {keys.map((key) => (
                <option key={key} value={key}>
                  {key.slice(provider.length + 1)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('settings:modelDefaults.defaultThinking')} description={t('settings:modelDefaults.defaultThinkingDesc')}>
        <select
          className={selectCls}
          aria-label={t('settings:modelDefaults.defaultThinking')}
          value={draft.defaultThinkingLevel || 'medium'}
          onChange={(event) => patch({ defaultThinkingLevel: event.target.value })}
        >
          {THINKING_LEVEL_KEYS.map((level) => (
            <option key={level} value={level}>
              {levelLabel(level)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('settings:modelDefaults.cycleScope')} description={t('settings:modelDefaults.cycleScopeDesc')}>
        <input
          className={cn(inputCls, 'w-[min(300px,70vw)] font-mono text-[12px]')}
          aria-label={t('settings:modelDefaults.cycleScope')}
          value={scopeText}
          placeholder={t('settings:modelDefaults.cycleScopePlaceholder')}
          onChange={(event) => setScopeText(event.target.value)}
          onBlur={() => {
            const patterns = scopeText.split(/[,\n]\s*/).map((part) => part.trim()).filter(Boolean)
            patch({ enabledModels: patterns.length ? patterns : undefined })
          }}
        />
      </SettingRow>
      <div className="model-bindings">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13.5px] font-medium text-foreground">{t('settings:modelDefaults.bindingsTitle')}</div>
            <p className="mt-0.5 max-w-xl text-[12px] leading-[1.55] text-foreground-secondary">{t('settings:modelDefaults.bindingsDesc')}</p>
          </div>
          <span className="text-[11.5px] tabular-nums text-foreground-secondary">
            {t('settings:modelDefaults.bindingsCount', { count: bindings.length })}
          </span>
        </div>
        {bindings.length > 0 ? (
          <ul className="model-binding-list mt-3">
            {bindings.map(([key, level]) => {
              const slash = key.indexOf('/')
              return (
                <li key={key} className="model-binding-row">
                  <span className="model-binding-provider">{key.slice(0, slash)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground" title={key}>
                    {key.slice(slash + 1)}
                  </span>
                  {!modelKeys.includes(key) && modelKeys.length > 0 ? (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">{t('settings:modelDefaults.bindingMissing')}</span>
                  ) : null}
                  <select
                    className={cn(selectCls, 'h-8 min-h-8 w-[150px] text-[12.5px]')}
                    value={level}
                    aria-label={t('settings:modelDefaults.bindingLevel', { model: key })}
                    onChange={(event) => patch({ modelThinkingLevels: { ...draft.modelThinkingLevels, [key]: event.target.value } })}
                  >
                    {THINKING_LEVEL_KEYS.map((option) => (
                      <option key={option} value={option}>
                        {levelLabel(option)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="chrome-icon-btn flex h-8 w-8 items-center justify-center rounded-md text-foreground-secondary hover:text-destructive"
                    aria-label={t('settings:modelDefaults.removeBinding', { model: key })}
                    title={t('settings:modelDefaults.removeBinding', { model: key })}
                    onClick={() => {
                      const next = { ...draft.modelThinkingLevels }
                      delete next[key]
                      patch({ modelThinkingLevels: next })
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-3 text-center text-[12px] text-foreground-secondary">
            {t('settings:modelDefaults.bindingsEmpty')}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className={cn(selectCls, 'h-8 min-h-8 min-w-[220px] flex-1 text-[12.5px]')}
            value={newModel}
            aria-label={t('settings:modelDefaults.pickModel')}
            onChange={(event) => setNewModel(event.target.value)}
          >
            <option value="">{t('settings:modelDefaults.pickModel')}</option>
            {modelsByProvider.map(([provider, keys]) => {
              const free = keys.filter((key) => unboundKeys.includes(key))
              if (free.length === 0) return null
              return (
                <optgroup key={provider} label={provider}>
                  {free.map((key) => (
                    <option key={key} value={key}>
                      {key.slice(provider.length + 1)}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
          <select
            className={cn(selectCls, 'h-8 min-h-8 w-[150px] text-[12.5px]')}
            value={newLevel}
            aria-label={t('settings:modelDefaults.pickLevel')}
            onChange={(event) => setNewLevel(event.target.value)}
          >
            {THINKING_LEVEL_KEYS.map((option) => (
              <option key={option} value={option}>
                {levelLabel(option)}
              </option>
            ))}
          </select>
          <button type="button" className={cn(btnOutline, 'h-8 min-h-8')} disabled={!newModel} onClick={addBinding}>
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            {t('settings:modelDefaults.addBinding')}
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}
