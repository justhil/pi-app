import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { showAppUpdateDialog } from '@renderer/lib/app-update-notify'

import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import { AppearanceThemeEditor } from '@renderer/features/settings/appearance-theme-editor'
import { RuntimeSettingsPanel } from '@renderer/features/settings/runtime-settings-panel'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { btnOutline, numberInputCls } from '@renderer/features/settings/settings-controls'
import { Switch } from '@renderer/components/ui/switch'
import {
  Folder,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  ThemedIcon,
  type AppIconComponent,
} from '@renderer/components/icons'
import { ICON_THEMES, type IconTheme } from '@shared/icon-theme'

export function GeneralSettings() {
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
    setAlertOnBackgroundRunIdle,
    setMaxSessionWorkers,
    setSessionWorkerIdleTimeoutMinutes,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [fixedOrder, setFixedOrder] = useState(false)
  const [updateCheck, setUpdateCheck] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const updateCheckAttemptRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      updateCheckAttemptRef.current += 1
    }
  }, [])

  useEffect(() => {
    ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
      if (res?.settings?.recentProjects) setRecentProjects(res.settings.recentProjects)
    })
    ipcClient.invoke('settings.get', { key: 'recentProjectsFixedOrder' }).then((res) => {
      if (typeof res?.settings?.recentProjectsFixedOrder === 'boolean') {
        setFixedOrder(res.settings.recentProjectsFixedOrder)
      }
    })
  }, [])

  const toggleFixedOrder = (next: boolean) => {
    setFixedOrder(next)
    void ipcClient.invoke('settings.set', { key: 'recentProjectsFixedOrder', value: next }).then(() => {
      // 通知侧栏立即按新顺序重排
      window.dispatchEvent(new CustomEvent('pi-desktop:settings-changed', { detail: { key: 'recentProjectsFixedOrder' } }))
    })
  }

  const handleCheckUpdate = async () => {
    const attempt = ++updateCheckAttemptRef.current
    setCheckingUpdate(true)
    setUpdateCheck(null)

    try {
      const result = await ipcClient.invoke('app.checkUpdate', {})
      if (!mountedRef.current || attempt !== updateCheckAttemptRef.current) return

      if (result.status === 'available') {
        setUpdateCheck(
          t('settings:general.updateHasNew', {
            version: result.update.latestVersion,
            current: result.update.currentVersion,
          }),
        )
        showAppUpdateDialog(result.update)
      } else if (result.status === 'up-to-date') {
        setUpdateCheck(t('settings:general.updateLatest', { version: result.latestVersion }))
      } else {
        setUpdateCheck(t('settings:general.updateCheckFailed'))
      }
      setCheckingUpdate(false)
    } catch {
      if (!mountedRef.current || attempt !== updateCheckAttemptRef.current) return
      setUpdateCheck(t('settings:general.updateCheckFailed'))
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader title={t('settings:general.title')} description={t('settings:general.description')} />

      <SettingsSection title={t('settings:general.startup')}>
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
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-busy={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className={btnOutline}
              >
                {checkingUpdate ? t('settings:general.checking') : t('settings:general.checkUpdate')}
              </button>
              <button
                type="button"
                onClick={() =>
                  void ipcClient.invoke('app.openRelease', { url: 'https://github.com/justhil/pi-app' })
                }
                className={btnOutline}
                title={t('settings:general.openGitHub')}
              >
                {t('settings:general.openGitHub')}
              </button>
            </div>
            {updateCheck && (
              <span className="max-w-[220px] text-xs text-muted-foreground/70 sm:text-right">{updateCheck}</span>
            )}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:general.alert')}>
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
        <SettingRow
          label={t('settings:general.alertOnBackgroundRunIdle')}
          description={t('settings:general.alertOnBackgroundRunIdleDesc')}
        >
          <Switch checked={draft.alertOnBackgroundRunIdle} onCheckedChange={setAlertOnBackgroundRunIdle} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings:general.workersAdvanced')}
        action={
          <button
            type="button"
            className="text-xs text-muted-foreground/70 hover:text-foreground"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? t('settings:general.hideAdvanced') : t('settings:general.showAdvanced')}
          </button>
        }
      >
        {advancedOpen ? (
          <>
            <SettingRow
              label={t('settings:general.maxSessionWorkers')}
              description={t('settings:general.maxSessionWorkersDesc')}
            >
              <input
                type="number"
                min={1}
                step={1}
                value={draft.maxSessionWorkers}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setMaxSessionWorkers(n)
                }}
                className={numberInputCls}
              />
            </SettingRow>
            <SettingRow
              label={t('settings:general.sessionWorkerIdleTimeout')}
              description={t('settings:general.sessionWorkerIdleTimeoutDesc')}
            >
              <input
                type="number"
                min={0}
                step={1}
                value={draft.sessionWorkerIdleTimeoutMinutes}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  setSessionWorkerIdleTimeoutMinutes(n)
                }}
                className={numberInputCls}
              />
            </SettingRow>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t('settings:general.language')}>
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
                  'settings-chip rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
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
      </SettingsSection>

      <RuntimeSettingsPanel />

      <SettingsSection title={t('settings:general.recentProjects')}>
        <SettingRow label={t('settings:general.fixedOrder')} description={t('settings:general.fixedOrderDesc')}>
          <Switch checked={fixedOrder} onCheckedChange={toggleFixedOrder} />
        </SettingRow>
        {recentProjects.length > 0 ? (
          <div className="space-y-1 py-3">
            {recentProjects.map((p, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-hover)]">
                <Folder className="h-3 w-3 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                <span className="truncate font-mono text-muted-foreground">{p}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <Sparkles className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} />
            <p className="mt-2 text-sm text-muted-foreground/70">{t('settings:general.noRecentProjects')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground/50">{t('settings:general.noRecentProjectsHint')}</p>
          </div>
        )}
      </SettingsSection>
    </div>
  )
}

export function AppearanceSettings() {
  const { t } = useTranslation()
  const { draft, setTheme, setIconTheme, setTimelineMaxAutoExpandedTools } = useSettingsDraft()

  const themes: { key: 'light' | 'dark' | 'system'; icon: AppIconComponent }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  return (
    <div className="flex flex-col gap-8">
      <SettingsPageHeader title={t('settings:appearance.title')} description={t('settings:appearance.description')} />

      <SettingsSection title={t('settings:appearance.themeTitle')}>
        <SettingRow label={t('settings:appearance.themeLabel')} description={t('settings:appearance.themeDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {themes.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                className={cn(
                  'settings-chip flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
                  draft.theme === key
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50'
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                {t(`settings:appearance.theme${key.charAt(0).toUpperCase() + key.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings:appearance.iconThemeTitle')}>
        <SettingRow
          label={t('settings:appearance.iconThemeLabel')}
          description={t('settings:appearance.iconThemeDesc')}
        >
          <div className="flex flex-wrap gap-1.5">
            {ICON_THEMES.map((theme: IconTheme) => (
              <button
                key={theme}
                type="button"
                aria-pressed={draft.iconTheme === theme}
                onClick={() => setIconTheme(theme)}
                className={cn(
                  'settings-chip flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-all duration-motion-fast ease-motion-ease',
                  draft.iconTheme === theme
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <ThemedIcon theme={theme} name="settings" className="h-3 w-3" />
                  <ThemedIcon theme={theme} name="terminal" className="h-3 w-3" />
                  <ThemedIcon theme={theme} name="search" className="h-3 w-3" />
                </span>
                {t(`settings:appearance.iconTheme${theme.charAt(0).toUpperCase() + theme.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      <AppearanceThemeEditor />

      <SettingsSection title={t('settings:appearance.timeline')}>
        <SettingRow
          label={t('settings:appearance.timelineToolAutoExpandMax')}
          description={t('settings:appearance.timelineToolAutoExpandMaxDesc')}
        >
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={draft.timelineMaxAutoExpandedTools}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setTimelineMaxAutoExpandedTools(n)
            }}
            className={numberInputCls}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  )
}

export function PiSettings() {
  return <PiSettingsPanel />
}
