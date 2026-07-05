import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { refreshComposerRunDisplay } from '@renderer/lib/composer-run-display'
import { applyPiDefaultModelToWorkerSession } from '@renderer/lib/sync-session-model'
import { useSettingsDirtySlice } from '@renderer/features/settings/use-settings-dirty-slice'
import { notifySettingsDirtyChanged } from '@renderer/features/settings/settings-dirty-registry'
import {
  settingsEqual,
  Section,
  type PiInfo,
  type PiSettingsSnapshot,
  type SdkStatus,
} from './pi-settings-shared'
import { PiSettingsSdkSection } from './pi-settings-sdk-section'
import { PiSettingsFormSections } from './pi-settings-form-sections'
import { PiSettingsEnvAuthRows } from './pi-settings-env-auth-rows'

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
      ])
      setInfo(infoRes as PiInfo)
      if (settingsRes?.error) setLoadError(settingsRes.error)
      const snap = settingsRes?.settings ?? null
      setSettings(snap)
      setBaseline(snap)
      setDraft(snap ? { ...snap } : null)
      setFormEpoch((n) => n + 1)
      await loadModelsForDropdown()
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

  const reloadSdk = useCallback(async () => {
    try {
      const [status, avail] = await Promise.all([
        ipcClient.invoke('sdk.status'),
        ipcClient.invoke('sdk.listAvailable'),
      ])
      setSdkStatus(status)
      setRegistry(avail)
      setEnvTarget(status?.active?.kind || 'builtin')
      setSelectedVersion((cur) => cur || (avail?.latest ?? ''))
    } catch (e) {
      console.error('sdk status load failed', e)
    }
  }, [])

  useEffect(() => {
    void reloadSdk()
  }, [reloadSdk])

  useEffect(() => {
    return onAppEvent((event) => {
      if (event.type !== 'sdk-install-progress') return
      if (event.line) setInstallOutput((prev) => [...prev, event.line!])
      if (event.done) {
        setInstalling(false)
        if (event.error) toast.error(`${t('settings:pi.upgradeFailed')}: ${event.error}`)
        else toast.success(t('settings:pi.upgradeSuccess'))
        void reloadSdk()
      }
    })
  }, [reloadSdk, t])

  const onInstall = useCallback(async () => {
    if (!selectedVersion) return
    setInstalling(true)
    setInstallOutput([])
    try {
      const res = await ipcClient.invoke('sdk.install', { version: selectedVersion })
      if (res?.ok === false) {
        setInstalling(false)
        toast.error(res.error || t('settings:pi.upgradeFailed'))
      }
    } catch (e: unknown) {
      setInstalling(false)
      toast.error(e instanceof Error ? e.message : t('settings:pi.upgradeFailed'))
    }
  }, [selectedVersion, t])

  const onSwitchEnv = useCallback(
    async (target: 'builtin' | 'global' | 'user') => {
      setSwitching(true)
      try {
        const res = await ipcClient.invoke('sdk.switch', { target })
        if (res?.ok === false) {
          toast.error(res.error || t('settings:pi.switchFailed'))
          return
        }
        const label =
          target === 'builtin'
            ? t('settings:pi.switchSuccessBuiltin')
            : target === 'global'
              ? t('settings:pi.switchSuccessGlobal')
              : t('settings:pi.switchSuccessUser')
        toast.success(label)
        void reloadSdk()
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : t('settings:pi.switchFailed'))
      } finally {
        setSwitching(false)
      }
    },
    [reloadSdk, t],
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
      const defaultModelChanged =
        String(baseline?.defaultProvider ?? '') !== String(draft.defaultProvider ?? '') ||
        String(baseline?.defaultModel ?? '') !== String(draft.defaultModel ?? '')
      const res = await ipcClient.invoke('pi.settings.set', { patch: draft })
      if (res?.ok === false) throw new Error(res.error || t('common:saveFailed'))
      await reloadPiForm()
      if (defaultModelChanged) await applyPiDefaultModelToWorkerSession()
      else await refreshComposerRunDisplay()
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
    return <p className="text-[13px] text-muted-foreground">{t('settings:pi.loading')}</p>
  }

  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{t('settings:pi.title')}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/70">{t('settings:pi.description')}</p>
        </div>
      </div>

      {loadError && (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
          {loadError} {t('settings:pi.loadErrorHint')}
        </div>
      )}

      <Section title={t('settings:pi.sectionEnvAuth')}>
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
        />
        {ui && <PiSettingsEnvAuthRows info={info} ui={ui} />}
      </Section>

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
      <p className="pt-2 text-[10px] text-muted-foreground/55">{t('settings:pi.treeHint')}</p>
    </div>
  )
}