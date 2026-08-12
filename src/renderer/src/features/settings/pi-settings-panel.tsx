import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import {
  settingsEqual,
  type PiInfo,
  type PiSettingsSnapshot,
  type SdkStatus,
} from './pi-settings-shared'
import { SettingsSection } from './settings-page-shared'
import { SettingsPageHeader } from './settings-shell'
import { PiSettingsSdkSection } from './pi-settings-sdk-section'
import { PiSettingsFormSections } from './pi-settings-form-sections'
import { PiSettingsEnvAuthRows } from './pi-settings-env-auth-rows'
import { savePiSettingsDraft } from './save-pi-settings'

export type { PiSettingsSnapshot } from './pi-settings-shared'

export function PiSettingsPanel() {
  const { t } = useTranslation()
  const thinkingOpts = [
    { v: 'off', l: t('settings:pi.thinkingOff') },
    { v: 'minimal', l: t('settings:pi.thinkingMinimal') },
    { v: 'low', l: t('settings:pi.thinkingLow') },
    { v: 'medium', l: t('settings:pi.thinkingMedium') },
    { v: 'high', l: t('settings:pi.thinkingHigh') },
    { v: 'xhigh', l: t('settings:pi.thinkingXhigh') },
  ]
  const [info, setInfo] = useState<PiInfo | null>(null)
  const [settings, setSettings] = useState<PiSettingsSnapshot | null>(null)
  const [models, setModels] = useState<Array<{ id: string; name?: string; provider?: string; available?: boolean }>>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<PiSettingsSnapshot | null>(null)
  const [draft, setDraft] = useState<PiSettingsSnapshot | null>(null)
  const [formEpoch, setFormEpoch] = useState(0)
  const [sdkStatus, setSdkStatus] = useState<SdkStatus | null>(null)
  const [registry, setRegistry] = useState<{ versions: string[]; latest: string | null } | null>(null)
  const [selectedVersion, setSelectedVersion] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installOutput, setInstallOutput] = useState<string[]>([])
  const [switching, setSwitching] = useState(false)
  const [envTarget, setEnvTarget] = useState<'builtin' | 'global' | 'user'>('builtin')
  const currentWorkspace = useUIStore((s) => s.currentWorkspace)
  const { draft: settingsDraft } = useSettingsDraft()
  const isWslRuntime = settingsDraft?.agentRuntime?.mode === 'wsl' && !!settingsDraft?.agentRuntime?.distro

  const loadModelsForDropdown = useCallback(async () => {
    try {
      const modelsRes = await ipcClient.invoke('model.list', { scope: 'catalog' })
      setModels((modelsRes?.models || []).filter((m: { available?: boolean }) => m.available !== false))
    } catch {
      setModels([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [infoRes, settingsRes] = await Promise.all([
        ipcClient.invoke('pi.getInfo'),
        ipcClient.invoke('pi.settings.get'),
        loadModelsForDropdown(),
      ])
      setInfo(infoRes as PiInfo)
      if (settingsRes?.error) setLoadError(settingsRes.error)
      const snap = settingsRes?.settings ?? null
      setSettings(snap)
      setBaseline(snap)
      setDraft(snap ? { ...snap } : null)
      setFormEpoch((n) => n + 1)
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : t('settings:pi.loadError'))
    }
  }, [loadModelsForDropdown, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadModelsForDropdown()
  }, [currentWorkspace, loadModelsForDropdown])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadModelsForDropdown()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [loadModelsForDropdown])

  const reloadSdk = useCallback(async (opts?: { refresh?: boolean }) => {
    const refreshArg = opts?.refresh ? { refresh: true } : {}
    const status = await ipcClient.invoke('sdk.status', refreshArg)
    setSdkStatus(status)
    setEnvTarget(status?.active?.kind || 'builtin')
    const avail = await ipcClient.invoke('sdk.listAvailable', refreshArg)
    setRegistry(avail)
    setSelectedVersion((cur) => cur || (avail?.latest ?? ''))
  }, [])

  useEffect(() => {
    void reloadSdk().catch((error) => console.error('sdk status load failed', error))
  }, [reloadSdk])

  useEffect(() => {
    return onAppEvent((event) => {
      if (event.type === 'sdk-runtime-changed') {
        void loadModelsForDropdown()
        return
      }
      if (event.type !== 'sdk-install-progress') return
      if (event.line) setInstallOutput((prev) => [...prev, event.line!])
    })
  }, [loadModelsForDropdown])

  const onInstall = useCallback(async () => {
    if (!selectedVersion) return
    setInstalling(true)
    setInstallOutput([])
    try {
      const res = await ipcClient.invoke('sdk.install', { version: selectedVersion })
      if (res?.ok === false) {
        toast.error(res.error || t('settings:pi.upgradeFailed'))
        return
      }
      setSdkStatus((current) => current ? { ...current, active: res.active } : current)
      setEnvTarget(res.active.kind)
      try {
        await Promise.all([
          reloadSdk({ refresh: true }),
          loadModelsForDropdown(),
        ])
      } catch (error) {
        console.error('sdk refresh after install failed', error)
      }
      toast.success(t('settings:pi.upgradeSuccess'))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('settings:pi.upgradeFailed'))
    } finally {
      setInstalling(false)
    }
  }, [loadModelsForDropdown, reloadSdk, selectedVersion, t])

  const onSwitchEnv = useCallback(
    async (target: 'builtin' | 'global' | 'user') => {
      setSwitching(true)
      try {
        const res = await ipcClient.invoke('sdk.switch', { target })
        if (res?.ok === false) {
          toast.error(res.error || t('settings:pi.switchFailed'))
          return
        }
        setSdkStatus((current) => current ? { ...current, active: res.active } : current)
        setEnvTarget(res.active.kind)
        try {
          await Promise.all([
            reloadSdk({ refresh: true }),
            loadModelsForDropdown(),
          ])
        } catch (error) {
          console.error('sdk refresh after switch failed', error)
        }
        const activeKind = res.active.kind
        const label =
          activeKind === 'builtin'
            ? t('settings:pi.switchSuccessBuiltin')
            : activeKind === 'global'
              ? t('settings:pi.switchSuccessGlobal')
              : t('settings:pi.switchSuccessUser')
        toast.success(label)
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t('settings:pi.switchFailed'))
      } finally {
        setSwitching(false)
      }
    },
    [loadModelsForDropdown, reloadSdk, t],
  )

  const queuePatch = useCallback((p: Record<string, unknown>) => {
    setDraft((prev) => ({ ...(prev || {}), ...p }))
    notifySettingsDirtyChanged()
  }, [])

  const reloadPiForm = useCallback(async () => {
    const settingsRes = await ipcClient.invoke('pi.settings.get')
    const snap = settingsRes?.settings ?? null
    setSettings(snap)
    setBaseline(snap)
    setDraft(snap ? { ...snap } : null)
    setFormEpoch((n) => n + 1)
  }, [])

  useSettingsDirtySlice({
    id: 'pi',
    label: t('settings:pi.title'),
    isDirty: () => !settingsEqual(draft, baseline),
    commit: async () => {
      if (!draft || settingsEqual(draft, baseline)) return
      try {
        await savePiSettingsDraft(draft, {
          setSettings: (patch) => ipcClient.invoke('pi.settings.set', { patch }),
          reload: reloadPiForm,
          refreshComposer: refreshComposerRunDisplay,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'SAVE_FAILED') {
          throw new Error(t('common:saveFailed'))
        }
        throw error
      }
    },
    discard: () => {
      void reloadPiForm()
    },
  })

  const ui = draft ?? settings

  const modelOptions = useMemo(() => {
    const list = [...models]
    const curP = String(ui?.defaultProvider || '')
    const curM = String(ui?.defaultModel || '')
    if (curP && curM && !list.some((m) => m.provider === curP && m.id === curM)) {
      list.unshift({ provider: curP, id: curM, name: `${curP}/${curM}`, available: true })
    }
    return list.sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`))
  }, [models, ui?.defaultProvider, ui?.defaultModel])

  const currentModelKey =
    ui?.defaultProvider && ui?.defaultModel ? `${ui.defaultProvider}/${ui.defaultModel}` : ''

  const onModelSelect = (key: string) => {
    const i = key.indexOf('/')
    if (i < 0) return
    queuePatch({ defaultProvider: key.slice(0, i), defaultModel: key.slice(i + 1) })
  }

  if (!ui && !loadError) {
    return <p className="text-base text-muted-foreground">{t('settings:pi.loading')}</p>
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:pi.title')} description={t('settings:pi.description')} />

      {loadError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {loadError} {t('settings:pi.loadErrorHint')}
        </div>
      )}

      <SettingsSection title={t('settings:pi.sectionEnvAuth')}>
        <PiSettingsSdkSection
          info={info}
          sdkStatus={sdkStatus}
          registry={registry}
          envTarget={envTarget}
          setEnvTarget={setEnvTarget}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          installing={installing}
          switching={switching}
          installOutput={installOutput}
          onSwitchEnv={onSwitchEnv}
          onInstall={onInstall}
          isWslRuntime={isWslRuntime}
        />
        {ui && <PiSettingsEnvAuthRows info={info} ui={ui} />}
      </SettingsSection>

      {ui && (
        <PiSettingsFormSections
          ui={ui}
          formEpoch={formEpoch}
          thinkingOpts={thinkingOpts}
          modelOptions={modelOptions}
          currentModelKey={currentModelKey}
          onModelSelect={onModelSelect}
          queuePatch={queuePatch}
        />
      )}
      <p className="text-2xs text-muted-foreground/50">{t('settings:pi.treeHint')}</p>
    </div>
  )
}