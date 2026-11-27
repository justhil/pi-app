import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { showAppUpdateDialog } from '@renderer/lib/app-update-notify'

import { useSettingsDraft } from '@renderer/features/settings/settings-draft-context'
import { isSandboxPath } from '@renderer/features/workspace/project-sidebar-types'
import { PiSettingsPanel } from '@renderer/features/settings/pi-settings-panel'
import { AppearanceThemeEditor } from '@renderer/features/settings/appearance-theme-editor'
import { AppearanceBackground } from '@renderer/features/settings/appearance-background'
import {
  WorkbenchComposerControls,
  WorkbenchReadingControls,
  WorkbenchShellControls,
  SHELL_LAYOUT_PRESETS,
} from '@renderer/features/settings/workbench-customizer-controls'
import { RuntimeSettingsPanel } from '@renderer/features/settings/runtime-settings-panel'
import { SessionWorkersSection } from '@renderer/features/settings/session-workers-section'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { SettingRow, SettingsSection } from '@renderer/features/settings/settings-page-shared'
import { btnCompact, btnOutline, numberInputCls } from '@renderer/features/settings/settings-controls'
import { Switch } from '@renderer/components/ui/switch'
import {
  Folder,
  Monitor,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  ThemedIcon,
  type AppIconComponent,
} from '@renderer/components/icons'
import { ICON_THEMES, type IconTheme } from '@shared/icon-theme'
import { applyUiZoom, readUiZoom } from '@renderer/lib/ui-zoom'
import {
  formatShortcut,
  readShortcutBindings,
  writeShortcutBindings,
  type ShortcutId,
} from '@renderer/lib/shortcut-bindings'

function ShortcutBindingsRow() {
  const { t } = useTranslation()
  const [bindings, setBindings] = useState(readShortcutBindings)
  const [listen, setListen] = useState<ShortcutId | null>(null)
  const ids: ShortcutId[] = ['commandPalette', 'shortcuts', 'completionNotification']
  return (
    <div className="space-y-2">
      {ids.map((id) => (
        <SettingRow
          key={id}
          label={t(`common:shortcuts.${id === 'shortcuts' ? 'thisSheet' : id}`)}
          description={t('common:shortcuts.navOnly')}
        >
          <button
            type="button"
            aria-label={t(`common:shortcuts.${id === 'shortcuts' ? 'thisSheet' : id}`)}
            aria-pressed={listen === id}
            className={`${btnOutline} min-w-[120px] font-mono text-xs`}
            onClick={() => setListen(id)}
            onBlur={() => setListen(null)}
            onKeyDown={(e) => {
              if (listen !== id) return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Escape') { setListen(null); return }
              if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key) || e.repeat) return
              const next = {
                ...bindings,
                [id]: {
                  key: e.key.toLowerCase(),
                  ctrl: e.ctrlKey || e.metaKey,
                  meta: e.ctrlKey || e.metaKey,
                  shift: e.shiftKey,
                  alt: e.altKey,
                },
              }
              setBindings(next)
              writeShortcutBindings(next)
              setListen(null)
            }}
          >
            {listen === id ? t('common:shortcuts.listen') : <kbd>{formatShortcut(bindings[id])}</kbd>}
          </button>
        </SettingRow>
      ))}
    </div>
  )
}

export function GeneralSettings() {
  const { t } = useTranslation()
  const {
    draft,
    setAutoOpenLastProject,
    setAutoCheckRegistryUpdates,
    setIncludePrereleaseUpdates,
    setLanguage,
    setAlertSoundEnabled,
    setAlertNotificationEnabled,
    setAlertOnExtensionUi,
    setAlertOnRunIdle,
    setAlertOnBackgroundRunIdle,
    setAlertOnRunFailed,
    setCompletionNotificationTimeoutSeconds,
    setCompletionNotificationPreview,
    setCompletionNotificationOnlyWhenUnfocused,
    setCompletionNotificationDndMinutes,
    setCompletionNotificationDelivery,
  } = useSettingsDraft()
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [fixedOrder, setFixedOrder] = useState(true)
  const activeSessionsDrawer = useUIStore((s) => s.sidebarActiveSessionsDrawer)
  const setActiveSessionsDrawer = useUIStore((s) => s.setSidebarActiveSessionsDrawer)
  const [updateCheck, setUpdateCheck] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [testingAlert, setTestingAlert] = useState(false)
  const [alertTestFeedback, setAlertTestFeedback] = useState<'sent' | 'failed' | null>(null)
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
    const loadRecentProjects = () => {
      ipcClient.invoke('settings.get', { key: 'recentProjects' }).then((res) => {
        if (!mountedRef.current) return
        if (Array.isArray(res?.settings?.recentProjects)) {
          setRecentProjects(res.settings.recentProjects.filter((p: string) => !isSandboxPath(p)))
        }
      })
    }
    loadRecentProjects()
    ipcClient.invoke('settings.get', { key: 'recentProjectsFixedOrder' }).then((res) => {
      if (!mountedRef.current) return
      if (typeof res?.settings?.recentProjectsFixedOrder === 'boolean') {
        setFixedOrder(res.settings.recentProjectsFixedOrder)
      }
    })
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail as { key?: string } | undefined
      if (!detail?.key || detail.key === 'recentProjects') {
        loadRecentProjects()
      }
    }
    window.addEventListener('pi-desktop:settings-changed', onSettingsChanged)
    return () => window.removeEventListener('pi-desktop:settings-changed', onSettingsChanged)
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

  const handleTestAlert = async () => {
    setTestingAlert(true)
    setAlertTestFeedback(null)
    try {
      const result = await ipcClient.invoke('alerts.test', {})
      setAlertTestFeedback(result?.ok === false ? 'failed' : 'sent')
    } catch {
      setAlertTestFeedback('failed')
    } finally {
      setTestingAlert(false)
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
        <SettingRow
          label={t('settings:general.prerelease')}
          description={t('settings:general.prereleaseDesc')}
        >
          <Switch checked={draft.includePrereleaseUpdates} onCheckedChange={setIncludePrereleaseUpdates} />
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

      <SettingsSection
        title={t('settings:general.alert')}
        description={t('settings:general.alertSectionDesc')}
      >
        <SettingRow label={t('settings:general.alertSound')} description={t('settings:general.alertSoundDesc')}>
          <Switch checked={draft.alertSoundEnabled} onCheckedChange={setAlertSoundEnabled} />
        </SettingRow>
        <SettingRow label={t('settings:general.alertNotification')} description={t('settings:general.alertNotificationDesc')}>
          <Switch checked={draft.alertNotificationEnabled} onCheckedChange={setAlertNotificationEnabled} />
        </SettingRow>
        {typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? (
          <p className="px-1 pb-2 text-[11px] text-muted-foreground">{t('settings:general.macNotifyHint')}</p>
        ) : null}
        <SettingRow
          label={t('settings:general.alertOnExtensionUi')}
          description={t('settings:general.alertOnExtensionUiDesc')}
        >
          <Switch checked={draft.alertOnExtensionUi} onCheckedChange={setAlertOnExtensionUi} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t('settings:general.completionAlert')}
        description={t('settings:general.completionAlertDesc')}
      >
        <SettingRow label={t('settings:general.alertOnRunIdle')} description={t('settings:general.alertOnRunIdleDesc')}>
          <Switch checked={draft.alertOnRunIdle} onCheckedChange={setAlertOnRunIdle} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.alertOnBackgroundRunIdle')}
          description={t('settings:general.alertOnBackgroundRunIdleDesc')}
        >
          <Switch checked={draft.alertOnBackgroundRunIdle} onCheckedChange={setAlertOnBackgroundRunIdle} />
        </SettingRow>
        <SettingRow label={t('settings:general.alertOnRunFailed')} description={t('settings:general.alertOnRunFailedDesc')}>
          <Switch checked={draft.alertOnRunFailed} onCheckedChange={setAlertOnRunFailed} />
        </SettingRow>
        <SettingRow
          label={t('settings:general.alertOnlyUnfocused')}
          description={t('settings:general.alertOnlyUnfocusedDesc')}
        >
          <Switch
            checked={draft.completionNotificationOnlyWhenUnfocused}
            onCheckedChange={setCompletionNotificationOnlyWhenUnfocused}
          />
        </SettingRow>
        <SettingRow label={t('settings:general.alertPreview.label')} description={t('settings:general.alertPreviewDesc')}>
          <div className="flex gap-1.5">
            {(['response', 'fixed'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.completionNotificationPreview === mode}
                onClick={() => setCompletionNotificationPreview(mode)}
                className={cn(
                  'settings-chip min-h-11 rounded-md border px-3 text-sm',
                  draft.completionNotificationPreview === mode
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {t(`settings:general.alertPreview.${mode}`)}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t('settings:general.alertDelivery.label')} description={t('settings:general.alertDeliveryDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {(['auto', 'custom', 'system'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.completionNotificationDelivery === mode}
                onClick={() => setCompletionNotificationDelivery(mode)}
                className={cn(
                  'settings-chip min-h-11 rounded-md border px-3 text-sm',
                  draft.completionNotificationDelivery === mode
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/50',
                )}
              >
                {t(`settings:general.alertDelivery.${mode}`)}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={t('settings:general.alertTimeout')} description={t('settings:general.alertTimeoutDesc')}>
          <input
            type="number"
            min={5}
            max={60}
            step={1}
            value={draft.completionNotificationTimeoutSeconds}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setCompletionNotificationTimeoutSeconds(n)
            }}
            className={numberInputCls}
          />
        </SettingRow>
        <SettingRow label={t('settings:general.alertDnd.label')} description={t('settings:general.alertDndDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {[
              { minutes: null as number | null, key: 'off' },
              { minutes: 3, key: '3m' },
              { minutes: 30, key: '30m' },
              { minutes: 60, key: '1h' },
            ].map((opt) => {
              const selected = opt.minutes == null
                ? !draft.completionNotificationDndUntil
                : draft.completionNotificationDndUntil != null &&
                  Math.abs(
                    draft.completionNotificationDndUntil - Date.now() - opt.minutes * 60_000,
                  ) < 5_000
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCompletionNotificationDndMinutes(opt.minutes)}
                  className={cn(
                    'settings-chip min-h-11 rounded-md border px-3 text-sm',
                    selected
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  {t(`settings:general.alertDnd.${opt.key}`)}
                </button>
              )
            })}
          </div>
        </SettingRow>
        <SettingRow label={t('settings:general.alertTest')} description={t('settings:general.alertTestDesc')}>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <button
              type="button"
              className={cn(btnOutline, 'min-h-11')}
              aria-busy={testingAlert}
              disabled={testingAlert}
              onClick={() => void handleTestAlert()}
            >
              {testingAlert ? t('settings:general.alertTesting') : t('settings:general.alertTestAction')}
            </button>
            {alertTestFeedback ? (
              <span
                role="status"
                className={cn(
                  'text-xs',
                  alertTestFeedback === 'sent' ? 'text-[var(--success-semantic)]' : 'text-destructive',
                )}
              >
                {alertTestFeedback === 'sent'
                  ? t('settings:general.alertTestSent')
                  : t('settings:general.alertTestFailed')}
              </span>
            ) : null}
          </div>
        </SettingRow>
      </SettingsSection>

      <SessionWorkersSection />

      <SettingsSection title={t('settings:general.language')}>
        <SettingRow label={t('settings:general.language')} description={t('settings:general.languageDesc')}>
          <div className="flex gap-1.5">
            {[
              { key: 'zh' as const, label: t('settings:general.langZh') },
              { key: 'en' as const, label: t('settings:general.langEn') },
              { key: 'ru' as const, label: t('settings:general.langRu') },
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

      <SettingsSection title={t('common:shortcuts.title')}>
        <ShortcutBindingsRow />
      </SettingsSection>

      <RuntimeSettingsPanel />

      <SettingsSection title={t('settings:general.recentProjects')}>
        <SettingRow
          label={t('settings:general.activeSessionsDrawer')}
          description={t('settings:general.activeSessionsDrawerDesc')}
        >
          <Switch checked={activeSessionsDrawer} onCheckedChange={setActiveSessionsDrawer} />
        </SettingRow>
        <SettingRow label={t('settings:general.fixedOrder')} description={t('settings:general.fixedOrderDesc')}>
          <Switch checked={fixedOrder} onCheckedChange={toggleFixedOrder} />
        </SettingRow>
        {recentProjects.length > 0 ? (
          <div className="max-h-64 space-y-1 overflow-y-auto py-3">
            {recentProjects.map((p) => (
              <div key={p} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-hover)]">
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
  const {
    draft,
    setTheme,
    setIconTheme,
    setTimelineMaxAutoExpandedTools,
    setTimelineVisibleTurns,
    setTimelineUserMessageStyle,
    setUiCustomization,
  } = useSettingsDraft()
  const [zoom, setZoom] = useState(readUiZoom)

  const themes: { key: 'light' | 'dark' | 'system'; icon: AppIconComponent }[] = [
    { key: 'light', icon: Sun },
    { key: 'dark', icon: Moon },
    { key: 'system', icon: Monitor },
  ]

  const jumpAnchors = [
    { id: 'appearance-base', label: t('settings:appearance.jump.base') },
    { id: 'appearance-shell', label: t('settings:appearance.jump.shell') },
    { id: 'appearance-themes', label: t('settings:appearance.jump.themes') },
    { id: 'appearance-background', label: t('settings:appearance.jump.background') },
    { id: 'appearance-composer', label: t('settings:appearance.jump.composer') },
    { id: 'appearance-timeline', label: t('settings:appearance.jump.timeline') },
  ] as const

  const scrollToAnchor = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <SettingsPageHeader
          title={t('settings:appearance.title')}
          description={t('settings:appearance.description')}
          action={
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('pi-desktop:open-live-theme-studio', {
                    detail: { theme: draft.customTheme },
                  }),
                )
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-[var(--brand)]/16"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
              <span>{t('settings:appearance.workbench.openLiveStudio')}</span>
            </button>
          }
        />

        {/* Compact quick-jump bar for navigating appearance subsections */}
        <div
          aria-label={t('settings:appearance.jump.label')}
          className="flex flex-wrap items-center gap-1.5 border-b border-[var(--shell-hairline)] pb-4"
        >
          {jumpAnchors.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => scrollToAnchor(a.id)}
              className="rounded-lg bg-foreground/[0.04] px-2.5 py-1 text-[12px] text-foreground-secondary transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Base Appearance: Mode, Icons, Zoom */}
      <SettingsSection id="appearance-base" title={t('settings:appearance.themeTitle')}>
        <SettingRow label={t('settings:appearance.themeLabel')} description={t('settings:appearance.themeDesc')}>
          <div className="flex flex-wrap gap-1.5">
            {themes.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  'settings-chip flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-all duration-motion-fast ease-motion-ease',
                  draft.theme === key
                    ? 'border-[var(--brand)]/60 bg-[var(--brand)]/10 font-medium text-foreground'
                    : 'border-border/75 text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                {t(`settings:appearance.theme${key.charAt(0).toUpperCase() + key.slice(1)}`)}
              </button>
            ))}
          </div>
        </SettingRow>
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
                  'settings-chip flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-all duration-motion-fast ease-motion-ease',
                  draft.iconTheme === theme
                    ? 'border-[var(--brand)]/60 bg-[var(--brand)]/10 font-medium text-foreground'
                    : 'border-border/75 text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground',
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
        <SettingRow label={t('settings:appearance.zoom')} description={t('settings:appearance.zoomDesc')}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('settings:appearance.zoom')}>
            {([0.9, 1, 1.1] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={zoom === n}
                className={cn(
                  'settings-chip rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                  zoom === n
                    ? 'border-[var(--brand)]/60 bg-[var(--brand)]/10 font-medium text-foreground'
                    : 'border-border/75 text-foreground-secondary hover:bg-foreground/[0.04] hover:text-foreground',
                )}
                onClick={() => {
                  setZoom(n)
                  applyUiZoom(n)
                }}
              >
                {Math.round(n * 100)}%
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingsSection>

      {/* 2. Workbench Shell & New Panels Customization */}
      <SettingsSection
        id="appearance-shell"
        title={t('settings:appearance.workbench.shellSectionTitle')}
        description={t('settings:appearance.workbench.shellSectionDesc')}
        action={
          <button
            type="button"
            onClick={() => setUiCustomization(SHELL_LAYOUT_PRESETS[0].patch)}
            className={btnCompact}
          >
            <RotateCcw className="h-3 w-3" />
            <span>{t('settings:appearance.workbench.resetDefault')}</span>
          </button>
        }
      >
        <div className="py-2">
          <WorkbenchShellControls ui={draft.uiCustomization} onUiChange={setUiCustomization} />
        </div>
      </SettingsSection>

      {/* 3. Theme Library, Presets, Effects & Advanced CSS */}
      <div id="appearance-themes" className="scroll-mt-6">
        <AppearanceThemeEditor />
      </div>

      {/* 4. Wallpaper Background */}
      <div id="appearance-background" className="scroll-mt-6">
        <AppearanceBackground />
      </div>

      {/* 5. Composer Customization */}
      <SettingsSection
        id="appearance-composer"
        title={t('settings:appearance.workbench.composerSectionTitle')}
        description={t('settings:appearance.workbench.composerSectionDesc')}
      >
        <div className="py-2">
          <WorkbenchComposerControls ui={draft.uiCustomization} onUiChange={setUiCustomization} />
        </div>
      </SettingsSection>

      {/* 6. Timeline & Reading */}
      <SettingsSection id="appearance-timeline" title={t('settings:appearance.timeline')}>
        <div className="py-2">
          <WorkbenchReadingControls
            userMessageStyle={draft.timelineUserMessageStyle}
            onUserMessageStyleChange={setTimelineUserMessageStyle}
            ui={draft.uiCustomization}
            onUiChange={setUiCustomization}
          />
        </div>
        <SettingRow
          label={t('settings:appearance.timelineVisibleTurns')}
          description={t('settings:appearance.timelineVisibleTurnsDesc')}
        >
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={draft.timelineVisibleTurns}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isFinite(n)) return
              setTimelineVisibleTurns(n)
            }}
            className={numberInputCls}
          />
        </SettingRow>
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
