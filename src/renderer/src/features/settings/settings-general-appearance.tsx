import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow } from '@renderer/features/settings/settings-page-shared'
import { Switch } from '@renderer/components/ui/switch'
import { Folder, Sparkles, Moon, Sun, Monitor, type LucideIcon } from 'lucide-react'

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
    setTimelineMaxAutoExpandedTools,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [updateCheck, setUpdateCheck] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
    } catch (e) {
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
        <SettingRow
          label={t('settings:general.alertOnBackgroundRunIdle')}
          description={t('settings:general.alertOnBackgroundRunIdleDesc')}
        >
          <Switch checked={draft.alertOnBackgroundRunIdle} onCheckedChange={setAlertOnBackgroundRunIdle} />
        </SettingRow>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <button
          type="button"
          className="mb-2 flex w-full items-center justify-between text-left"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/75">
            {t('settings:general.advanced')}
          </span>
          <span className="text-[11px] text-muted-foreground/60">
            {advancedOpen ? t('settings:general.hideAdvanced') : t('settings:general.showAdvanced')}
          </span>
        </button>
        {advancedOpen ? (
          <div className="space-y-0">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {t('settings:general.workers')}
            </div>
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
                className="w-[5.5rem] rounded-lg border border-border bg-background px-2.5 py-1 text-right text-[12px] tabular-nums text-foreground"
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
                className="w-[5.5rem] rounded-lg border border-border bg-background px-2.5 py-1 text-right text-[12px] tabular-nums text-foreground"
              />
            </SettingRow>
            <div className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {t('settings:general.timeline')}
            </div>
            <SettingRow
              label={t('settings:general.timelineToolAutoExpandMax')}
              description={t('settings:general.timelineToolAutoExpandMaxDesc')}
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
                className="w-[5.5rem] rounded-lg border border-border bg-background px-2.5 py-1 text-right text-[12px] tabular-nums text-foreground"
              />
            </SettingRow>
          </div>
        ) : null}
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

export function AppearanceSettings() {
  const { t } = useTranslation()
  const { draft, setTheme } = useSettingsDraft()

  const themes: { key: 'light' | 'dark' | 'system'; icon: LucideIcon }[] = [
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

export function PiSettings() {
  return <PiSettingsPanel />
}

