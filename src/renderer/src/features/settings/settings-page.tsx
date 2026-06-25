import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { ExtensionConfigSubpage } from '@renderer/features/extension-ui/extension-config-subpage'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import { ModelsSettingsPanel } from '@renderer/features/settings/models-settings-panel'
import { Settings as SettingsIcon, Palette, Cpu, Puzzle, Zap, MessageSquareText, Mic,
  Moon, Sun, Monitor, Folder, Layers, ChevronLeft, LayoutPanelLeft, Boxes, Sparkles
} from 'lucide-react'
import { resolveAdapterText } from '@extension-compat/adapter-schema'
import i18n from '@renderer/lib/i18n'
import { SkillsSettingsPanel } from '@renderer/features/settings/skills-settings-panel'
import { PromptsSettingsPanel } from '@renderer/features/settings/prompts-settings-panel'
import {
  SettingsMain,
  SettingsNav,
  SettingsNavItem,
  SettingsPageHeader,
} from '@renderer/features/settings/settings-shell'
import { RightPanelsSettings } from '@renderer/features/settings/right-panels-settings'
import { VoiceSettingsPanel } from '@renderer/features/settings/voice-settings-panel'
import { SettingsDraftProvider } from '@renderer/features/settings/settings-draft-context'
import { SettingsSaveBar } from '@renderer/features/settings/settings-save-bar'
import { invalidateRightPanelCatalog } from '@renderer/lib/right-panel-runtime'
import { Switch } from '@renderer/components/ui/switch'

type SettingsPage = 'general' | 'appearance' | 'rightPanels' | 'pi' | 'models' | 'skills' | 'prompts' | 'extensions' | 'adapters' | 'voice'

export function SettingsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState<SettingsPage>('general')
  const [configExt, setConfigExt] = useState<string | null>(null)
  const pendingExtensionConfig = useUIStore((s) => s.pendingExtensionConfig)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  const PAGES: { key: SettingsPage; icon: any; label: string }[] = [
    { key: 'general', icon: SettingsIcon, label: t('settings:nav.general') },
    { key: 'appearance', icon: Palette, label: t('settings:nav.appearance') },
    { key: 'rightPanels', icon: LayoutPanelLeft, label: t('settings:nav.rightPanels') },
    { key: 'pi', icon: Cpu, label: t('settings:nav.pi') },
    { key: 'models', icon: Boxes, label: t('settings:nav.models') },
    { key: 'skills', icon: Zap, label: t('settings:nav.skills') },
    { key: 'prompts', icon: MessageSquareText, label: t('settings:nav.prompts') },
    { key: 'extensions', icon: Puzzle, label: t('settings:nav.extensions') },
    { key: 'adapters', icon: Layers, label: t('settings:nav.adapters') },
    { key: 'voice', icon: Mic, label: t('settings:nav.voice') },
  ]

  // 外置 adapter.json 可能在设置外被修改；进入设置时刷新 Main 缓存与右栏目录
  useEffect(() => {
    invalidateRightPanelCatalog()
    void ipcClient.invoke('adapters.json.catalog', { refresh: true })
  }, [])

  // B-layer slash config-page routing -> open embedded config subpage
  useEffect(() => {
    if (pendingExtensionConfig) {
      setConfigExt(pendingExtensionConfig)
      setPage('adapters')
      requestExtensionConfig(null)
    }
  }, [pendingExtensionConfig, requestExtensionConfig])

  // Config detail subpage (replaces modal)
  if (configExt) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setConfigExt(null)}
            className="electron-no-drag chrome-icon-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('settings:adapters.backToAdapters')}
          </button>
          <span className="text-[13px] font-medium">{t('settings:adapters.configTitle', { id: configExt })}</span>
        </div>
        <SettingsMain wide>
          <div className="animate-in fade-in slide-in-from-right duration-motion-normal">
            <ExtensionConfigSubpage extensionId={configExt} />
          </div>
        </SettingsMain>
      </div>
    )
  }

  const widePages: SettingsPage[] = ['rightPanels', 'pi', 'models', 'skills', 'prompts', 'extensions', 'adapters', 'voice']
  const wide = widePages.includes(page)

  return (
    <SettingsDraftProvider>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <SettingsNav title={t('settings:title')}>
          {PAGES.map((p) => (
            <SettingsNavItem
              key={p.key}
              active={page === p.key}
              icon={p.icon}
              label={p.label}
              onClick={() => setPage(p.key)}
            />
          ))}
        </SettingsNav>
        <SettingsMain wide={wide} footer={<SettingsSaveBar />}>
          {page === 'general' && <GeneralSettings />}
          {page === 'appearance' && <AppearanceSettings />}
          {page === 'rightPanels' && <RightPanelsSettings />}
          {page === 'pi' && <PiSettings />}
          {page === 'models' && <ModelsSettingsPanel />}
          {page === 'skills' && <SkillsSettingsPanel />}
          {page === 'prompts' && <PromptsSettingsPanel />}
          {page === 'extensions' && <ExtensionsSettings />}
          {page === 'adapters' && <AdaptersSettings />}
          {page === 'voice' && <VoiceSettingsPanel />}
        </SettingsMain>
      </div>
    </SettingsDraftProvider>
  )
}

function SettingRow({ label, description, children }: any) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/40 last:border-0">
      <div className="flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {description && <div className="text-[11px] text-muted-foreground/75 mt-0.5">{description}</div>}
      </div>
      <div className="ml-4 shrink-0">{children}</div>
    </div>
  )
}


function GeneralSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setAutoOpenLastProject,
    setAutoCheckRegistryUpdates,
    setLanguage,
    setAlertSoundEnabled,
    setAlertNotificationEnabled,
    setAlertOnExtensionUi,
    setAlertOnRunIdle,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [updateCheck, setUpdateCheck] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      if (res?.settings?.recentProjects) setRecentProjects(res.settings.recentProjects)
    })
  }, [])

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateCheck(null)
    try {
      const r = await ipcClient.invoke('app.checkUpdate', {})
      if (!r?.ok) {
        setUpdateCheck(r?.error || t('settings:general.updateCheckFailed'))
        return
      }
      if (r.hasUpdate && r.latestVersion) {
        setUpdateCheck(t('settings:general.updateHasNew', { version: r.latestVersion, current: r.currentVersion }))
        toast.info(t('settings:general.foundNewVersion', { version: r.latestVersion }), {
          action: {
            label: t('settings:general.openReleasePage'),
            onClick: () => void ipcClient.invoke('app.openRelease', { url: r.releaseUrl }),
          },
        })
      } else {
        setUpdateCheck(t('settings:general.updateLatest', { version: r.currentVersion }))
      }
    } catch {
      setUpdateCheck(t('settings:general.updateCheckFailed'))
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('settings:general.title')} description={t('settings:general.description')} />
      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">{t('settings:general.startup')}</div>
        <SettingRow label={t('settings:general.openLastProject')} description={t('settings:general.openLastProjectDesc')}>
          <Switch checked={draft.autoOpenLastProject} onCheckedChange={setAutoOpenLastProject} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.autoCheckUpdate')}
          description={t('settings:general.autoCheckUpdateDesc')}
        >
          <Switch checked={draft.autoCheckRegistryUpdates} onCheckedChange={setAutoCheckRegistryUpdates} />
        </SettingRow>
        <SettingRow label={t('settings:general.appVersion')} description={t('settings:general.appVersionDesc')}>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={checkingUpdate}
              onClick={() => void handleCheckUpdate()}
              className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground hover:bg-accent/50 disabled:opacity-50"
            >
              {checkingUpdate ? t('settings:general.checking') : t('settings:general.checkUpdate')}
            </button>
            {updateCheck && (
              <span className="max-w-[220px] text-right text-[11px] text-muted-foreground/75">{updateCheck}</span>
            )}
          </div>
        </SettingRow>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">{t('settings:general.alert')}</div>
        <SettingRow label={t('settings:general.alertSound')} description={t('settings:general.alertSoundDesc')}>
          <Switch checked={draft.alertSoundEnabled} onCheckedChange={setAlertSoundEnabled} />
        </SettingRow>
        <SettingRow label={t('settings:general.alertNotification')} description={t('settings:general.alertNotificationDesc')}>
          <Switch checked={draft.alertNotificationEnabled} onCheckedChange={setAlertNotificationEnabled} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.alertOnExtensionUi')}
          description={t('settings:general.alertOnExtensionUiDesc')}
        >
          <Switch checked={draft.alertOnExtensionUi} onCheckedChange={setAlertOnExtensionUi} />
        </SettingRow>
        <SettingRow label={t('settings:general.alertOnRunIdle')} description={t('settings:general.alertOnRunIdleDesc')}>
          <Switch checked={draft.alertOnRunIdle} onCheckedChange={setAlertOnRunIdle} />
        </SettingRow>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">{t('settings:general.language')}</div>
        <SettingRow label={t('settings:general.language')} description={t('settings:general.languageDesc')}>
          <div className="flex gap-1.5">
            {[
              { key: 'zh' as const, label: t('settings:general.langZh') },
              { key: 'en' as const, label: t('settings:general.langEn') },
            ].map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLanguage(l.key)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                  draft.language === l.key
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">{t('settings:general.recentProjects')}</div>
        {recentProjects.length > 0 ? (
          <div className="space-y-1">
            {recentProjects.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5 text-[12px]">
                <Folder className="h-3 w-3 text-muted-foreground/50" />
                <span className="truncate font-mono text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Sparkles className="h-7 w-7 text-muted-foreground/30" />
            <p className="mt-2 text-[12px] text-muted-foreground/60">{t('settings:general.noRecentProjects')}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/45">{t('settings:general.noRecentProjectsHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function AppearanceSettings() {
  const { t } = useTranslation()
  const { draft, setTheme } = useSettingsDraft()

  const themes: { key: 'light' | 'dark' | 'system'; icon: any }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('settings:appearance.title')} description={t('settings:appearance.description')} />
      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">{t('settings:appearance.themeTitle')}</div>
        <SettingRow label={t('settings:appearance.themeLabel')} description={t('settings:appearance.themeDesc')}>
          <div className="flex gap-1.5">
            {themes.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all duration-motion-fast ease-motion-ease',
                  draft.theme === key
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(`settings:appearance.theme${key.charAt(0).toUpperCase() + key.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  )
}

function PiSettings() {
  return <PiSettingsPanel />
}

function ExtensionsSettings() {
  const { t } = useTranslation()
  const [extensions, setExtensions] = useState<any[]>([])
  const [runtimeTools, setRuntimeTools] = useState<any[]>([])
  const [missingRuntime, setMissingRuntime] = useState<any[]>([])
  const [syncing, setSyncing] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const refreshExtensions = () => {
    ipcClient.invoke('extensions.list').then((res) => {
      setExtensions(res?.extensions || [])
    })
    ipcClient.invoke('extensions.missingRuntimePackages').then((res) => {
      setMissingRuntime(res?.missing || [])
    })
    ipcClient.invoke('runtime.getState').then((res) => {
      setRuntimeTools(Array.isArray(res?.state?.tools) ? res.state.tools : [])
    }).catch(() => setRuntimeTools([]))
  }

  useEffect(() => {
    refreshExtensions()
  }, [])

  const handleToggle = async (ext: any) => {
    if (!ext.piSync) {
      toast.error(ext.inSettingsPackages === false ? t('settings:extensions.workerLoadHint') : t('settings:extensions.notSynced'))
      return
    }
    const next = !(ext.piEnabled ?? ext.enabled)
    setTogglingId(ext.id)
    try {
      const res = await ipcClient.invoke('extensions.setEnabled', { extensionId: ext.id, enabled: next })
      if (!res?.ok) {
        toast.error(res?.error || t('common:saveFailed'))
        return
      }
      toast.success(next ? t('settings:extensions.piEnabled') : t('settings:extensions.piDisabled'))
      refreshExtensions()
    } catch {
      toast.error(t('common:operationFailed'))
    } finally {
      setTogglingId(null)
    }
  }

  const COMPAT_STYLES: Record<string, string> = {
    native: 'bg-green-500/10 text-green-600 dark:text-green-400',
    basic: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    headless: 'bg-muted text-muted-foreground',
    blocked: 'bg-destructive/10 text-destructive',
  }

  const COMPAT_LABELS: Record<string, string> = {
    native: t('settings:extensions.compatNative'),
    basic: t('settings:extensions.compatBasic'),
    headless: t('settings:extensions.compatHeadless'),
    blocked: t('settings:extensions.compatBlocked'),
  }

  const runtimeNames = new Set(runtimeTools.map((t) => t.name))
  const watchedTools = ['fast_context_search', 'search', 'search_sources', 'ffgrep', 'fffind']

  return (
    <div className="space-y-1 w-full">
      <SettingsPageHeader
        title={t('settings:extensions.title')}
        description={t('settings:extensions.description')}
      />
      {missingRuntime.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-500/8 p-3">
          <div className="text-[12px] font-medium text-amber-800 dark:text-amber-200">{t('settings:extensions.missingRuntime')}</div>
          <p className="mt-1 text-[11px] text-foreground-secondary leading-relaxed">
            {t('settings:extensions.missingRuntimeDesc')}
          </p>
          <ul className="mt-2 space-y-1 text-[11px] font-mono text-foreground-secondary">
            {missingRuntime.map((m: any) => (
              <li key={m.entry}>· {m.repoFolder} → {m.entry}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={syncing}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground disabled:opacity-50"
            onClick={() => {
              setSyncing(true)
              ipcClient.invoke('extensions.syncGitPackages').then((r) => {
                if (r?.added?.length) toast.success(t('settings:extensions.syncSuccess', { list: r.added.join(', ') }))
                else if (r?.error) toast.error(r.error)
                refreshExtensions()
              }).catch(() => toast.error(t('settings:extensions.syncFailed'))).finally(() => setSyncing(false))
            }}
          >
            {syncing ? t('settings:extensions.syncing') : t('settings:extensions.writePackages')}
          </button>
        </div>
      )}
      <div className="mb-3 rounded-lg border border-border/50 bg-muted/20 p-2.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('settings:extensions.workerTools')} {runtimeTools.length ? `(${runtimeTools.length})` : t('settings:extensions.workerToolsEmpty')}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {watchedTools.map((name) => (
            <span
              key={name}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                runtimeNames.has(name) ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground/45',
              )}
            >
              {runtimeNames.has(name) ? '✓ ' : '· '}{name}
            </span>
          ))}
        </div>
      </div>
      {extensions.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          {t('settings:extensions.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {extensions.map((ext) => {
            const isOn = ext.piEnabled ?? ext.enabled
            const canToggle = ext.piSync === true
            return (
              <div key={`${ext.source}-${ext.id}`} className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{ext.name}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', COMPAT_STYLES[ext.compatibility])}>
                        {COMPAT_LABELS[ext.compatibility] || ext.compatibility}
                      </span>
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                        ext.source === 'project' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}>
                        {ext.source === 'package' ? t('settings:extensions.sourcePackage') : ext.source === 'project' ? t('settings:extensions.sourceProject') : t('settings:extensions.sourceGlobal')}
                      </span>
                      {ext.piSync ? (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[9px] font-medium',
                            isOn ? 'bg-green-500/12 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isOn ? t('settings:extensions.piEnabled') : t('settings:extensions.piDisabled')}
                        </span>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-[9px] text-muted-foreground">{t('settings:extensions.notSynced')}</span>
                      )}
                    </div>
                    {ext.description && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground/75 truncate">{ext.description}</div>
                    )}
                    {ext.registeredTools.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ext.registeredTools.map((t: string) => (
                          <span key={t} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    {ext.registeredCommands.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ext.registeredCommands.map((c: string) => (
                          <span key={c} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            /{c}
                          </span>
                        ))}
                      </div>
                    )}
                    {ext.adapterId ? (
                      <div className="mt-1 text-[10px] text-green-700 dark:text-green-400">
                        {t('settings:extensions.adapterLinked')}<span className="font-medium">{ext.adapterId}</span>
                      </div>
                    ) : ext.tuiOnly ? (
                      <div className="mt-1 text-[10px] text-muted-foreground/70 italic">
                        {t('settings:extensions.tuiOnly')}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-muted-foreground/55 italic">
                        {t('settings:extensions.noAdapter')}
                      </div>
                    )}
                    {ext.inSettingsPackages === false && ext.workerLoadHint && (
                      <div className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-900 dark:text-amber-200">
                        {ext.workerLoadHint}
                      </div>
                    )}
                    {ext.loadError && (
                      <div className="mt-1 text-[10px] text-destructive">{ext.loadError}</div>
                    )}
                  </div>
                  <Switch
                    checked={isOn}
                    onCheckedChange={() => void handleToggle(ext)}
                    disabled={!canToggle || togglingId === ext.id}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const TIER_STYLES: Record<string, string> = {
  native: 'bg-green-500/10 text-green-700 dark:text-green-400',
  partial: 'bg-amber-500/10 text-amber-800 dark:text-amber-400',
  headless: 'bg-muted text-muted-foreground',
  none: 'bg-muted text-muted-foreground',
}

function AdaptersSettings() {
  const { t } = useTranslation()
  const [adapters, setAdapters] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestExtensionConfig = useUIStore((s) => s.requestExtensionConfig)

  const TIER_LABELS: Record<string, string> = {
    native: t('settings:adapters.tierNative'),
    partial: t('settings:adapters.tierPartial'),
    headless: t('settings:adapters.tierHeadless'),
    none: t('settings:adapters.tierNone'),
  }

  useEffect(() => {
    setError(null)
    // v2-only catalog: adapters.catalog already merges probed plugins with v2 adapter.json + orphans.
    ipcClient
      .invoke('adapters.catalog')
      .then((res) => {
        setAdapters(Array.isArray(res?.adapters) ? res.adapters : [])
      })
      .catch((e) => {
        setAdapters([])
        setError(String(e))
      })
  }, [])

  if (adapters === null) {
    return <div className="text-[12px] text-muted-foreground/50 py-4">{t('settings:adapters.loading')}</div>
  }

  return (
    <div className="w-full space-y-3">
      <SettingsPageHeader
        title={t('settings:adapters.title')}
        description={t('settings:adapters.description')}
      />
      {error && <div className="text-[11px] text-destructive">{error}</div>}
      {adapters.length === 0 ? (
        <div className="text-[12px] text-muted-foreground/50 py-4">
          {t('settings:adapters.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {adapters.map((a) => {
            const resolved = a.adapterJson ? resolveAdapterText(a.adapterJson, i18n.language) : null
            return (
            <div key={a.pluginId} className="rounded-lg border border-border/60 bg-card/40 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-medium">{resolved?.displayName || a.displayName}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase', TIER_STYLES[a.tier])}>
                  {TIER_LABELS[a.tier] || a.tier}
                </span>
                <span className="text-[10px] text-muted-foreground">{a.source}</span>
                {a.version && <span className="text-[10px] font-mono text-muted-foreground">v{a.version}</span>}
                {a.adapterVersion && (
                  <span className="text-[10px] text-muted-foreground">{t('settings:adapters.tierPartial')} v{a.adapterVersion}</span>
                )}
              </div>
              {(resolved?.description || a.description) && <p className="mt-1 text-[12px] text-muted-foreground/80">{resolved?.description || a.description}</p>}
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{t('settings:adapters.desktop')}</span>
                {resolved?.description || a.desktopSupport}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono">
                probe: {a.matchMeta?.probeId}
                {a.matchMeta?.npmPackage ? ` · npm: ${a.matchMeta.npmPackage}` : ''}
              </div>
              {a.registeredTools?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.registeredTools.map((t: string) => (
                    <span key={t} className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px]">{t}</span>
                  ))}
                </div>
              )}
              {a.tier !== 'none' && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => requestExtensionConfig(a.id)}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-accent"
                  >
                    {t('settings:adapters.openConfig')}
                  </button>
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
