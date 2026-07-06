import type { i18n as I18n } from 'i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AsrConfig } from '@shared/asr-types'
import { normalizeTimelineMaxAutoExpandedTools } from '@shared/timeline-settings'
import {
  normalizeRightPanelOrder,
  normalizeRightPanelPrefs,
  type RightPanelCatalogItem,
  type RightPanelPrefs,
} from '@shared/right-panels'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type LanguageChoice = 'zh' | 'en'

export type SettingsDraft = {
  theme: ThemeChoice
  language: LanguageChoice
  autoOpenLastProject: boolean
  autoCheckRegistryUpdates: boolean
  alertSoundEnabled: boolean
  alertNotificationEnabled: boolean
  alertOnExtensionUi: boolean
  alertOnRunIdle: boolean
  timelineMaxAutoExpandedTools: number
  extensionOverrides: Record<string, boolean>
  rightPanelCatalog: RightPanelCatalogItem[]
  rightPanelPrefs: RightPanelPrefs
  rightPanelOrder: string[]
  asrConfig: AsrConfig
}

function normalizeLanguage(raw: unknown, fallback: LanguageChoice): LanguageChoice {
  const s = String(raw || '').toLowerCase()
  if (s.startsWith('zh')) return 'zh'
  if (s.startsWith('en')) return 'en'
  return fallback
}

function normalizeAsrForSignature(cfg: AsrConfig): AsrConfig {
  const token = cfg.codexAccessToken?.trim()
  return {
    ...cfg,
    codexAccessToken: token || undefined,
    codexAuthFile: cfg.codexAuthFile?.trim() || undefined,
    cliBinaryPath: cfg.cliBinaryPath?.trim() || undefined,
    serverUrl: cfg.serverUrl?.trim() || undefined,
    apiKey: cfg.apiKey?.trim() || undefined,
    codexAccessTokenSet: cfg.codexAccessTokenSet,
    codexAccessTokenPreview: cfg.codexAccessTokenPreview,
    codexAccessTokenPreserved: cfg.codexAccessTokenPreserved,
  }
}

export function asrConfigFromSettingsResponse(raw: AsrConfig): AsrConfig {
  const a = raw || { provider: 'codex-asr-builtin' as const, language: 'auto' as const, timeoutMs: 120000, builtinServePort: 18788 }
  const base = a.provider === 'none' ? { ...a, provider: 'codex-asr-builtin' as const } : a
  return normalizeAsrForSignature({
    ...base,
    codexAccessToken: base.codexAccessToken?.trim() || undefined,
  })
}

export function draftSignature(d: SettingsDraft): string {
  return JSON.stringify({
    theme: d.theme,
    language: d.language,
    autoOpenLastProject: d.autoOpenLastProject,
    autoCheckRegistryUpdates: d.autoCheckRegistryUpdates,
    alertSoundEnabled: d.alertSoundEnabled,
    alertNotificationEnabled: d.alertNotificationEnabled,
    alertOnExtensionUi: d.alertOnExtensionUi,
    alertOnRunIdle: d.alertOnRunIdle,
    timelineMaxAutoExpandedTools: d.timelineMaxAutoExpandedTools,
    extensionOverrides: d.extensionOverrides,
    rightPanelPrefs: d.rightPanelPrefs,
    rightPanelOrder: d.rightPanelOrder,
    asrConfig: normalizeAsrForSignature(d.asrConfig),
  })
}

export async function loadSettingsDraftFromDisk(i18nLanguage: string): Promise<SettingsDraft> {
  const [settingsRes, rpRes] = await Promise.all([
    ipcClient.invoke('settings.get', {}).catch(() => ({ settings: {} })),
    ipcClient.invoke('rightPanels.catalog').catch(() => null),
  ])
  const s = settingsRes?.settings || {}
  const cat = (rpRes?.catalog as RightPanelCatalogItem[]) || []
  const prefs = normalizeRightPanelPrefs(s.rightPanelPrefs ?? rpRes?.prefs, cat)
  const order = normalizeRightPanelOrder(s.rightPanelOrder ?? rpRes?.order, cat)

  return {
    theme: (s.theme as ThemeChoice) || 'system',
    language: normalizeLanguage(s.language, normalizeLanguage(i18nLanguage, 'zh')),
    autoOpenLastProject: s.autoOpenLastProject !== false,
    autoCheckRegistryUpdates: s.autoCheckRegistryUpdates !== false,
    alertSoundEnabled: s.alertSoundEnabled !== false,
    alertNotificationEnabled: s.alertNotificationEnabled !== false,
    alertOnExtensionUi: s.alertOnExtensionUi !== false,
    alertOnRunIdle: s.alertOnRunIdle !== false,
    timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(s.timelineMaxAutoExpandedTools),
    extensionOverrides: { ...(s.extensionOverrides || {}) },
    rightPanelCatalog: cat,
    rightPanelPrefs: prefs,
    rightPanelOrder: order,
    asrConfig: asrConfigFromSettingsResponse((s.asrConfig || {}) as AsrConfig),
  }
}

export function applyThemeToDocument(theme: ThemeChoice): void {
  if (theme === 'dark') document.documentElement.classList.add('dark')
  else if (theme === 'light') document.documentElement.classList.remove('dark')
  else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', isDark)
  }
}

/** 仅界面预览，不写盘 */
export function previewDraftUi(draft: SettingsDraft, i18n: I18n): void {
  applyThemeToDocument(draft.theme)
  if (i18n.language !== draft.language) void i18n.changeLanguage(draft.language)
}

export async function commitSettingsDraft(draft: SettingsDraft, i18n: I18n): Promise<AsrConfig> {
  await ipcClient.invoke('settings.set', { key: 'theme', value: draft.theme })
  await ipcClient.invoke('settings.set', { key: 'language', value: draft.language })
  await ipcClient.invoke('settings.set', { key: 'autoOpenLastProject', value: draft.autoOpenLastProject })
  await ipcClient.invoke('settings.set', { key: 'autoCheckRegistryUpdates', value: draft.autoCheckRegistryUpdates })
  await ipcClient.invoke('settings.set', { key: 'alertSoundEnabled', value: draft.alertSoundEnabled })
  await ipcClient.invoke('settings.set', { key: 'alertNotificationEnabled', value: draft.alertNotificationEnabled })
  await ipcClient.invoke('settings.set', { key: 'alertOnExtensionUi', value: draft.alertOnExtensionUi })
  await ipcClient.invoke('settings.set', { key: 'alertOnRunIdle', value: draft.alertOnRunIdle })
  await ipcClient.invoke('settings.set', {
    key: 'timelineMaxAutoExpandedTools',
    value: draft.timelineMaxAutoExpandedTools,
  })
  await ipcClient.invoke('settings.set', { key: 'extensionOverrides', value: draft.extensionOverrides })
  await ipcClient.invoke('rightPanels.saveLayout', {
    prefs: draft.rightPanelPrefs,
    order: draft.rightPanelOrder,
  })

  const asrRes = await ipcClient.invoke('settings.set', { key: 'asrConfig', value: draft.asrConfig })
  const savedAsr = asrConfigFromSettingsResponse((asrRes?.value || draft.asrConfig) as AsrConfig)
  draft.asrConfig = savedAsr

  useUIStore.getState().setTheme(draft.theme)
  useUIStore.getState().setTimelineMaxAutoExpandedTools(draft.timelineMaxAutoExpandedTools)
  applyThemeToDocument(draft.theme)
  if (i18n.language !== draft.language) await i18n.changeLanguage(draft.language)
  useUIStore.getState().applyRightPanelRuntime(
    draft.rightPanelCatalog,
    draft.rightPanelPrefs,
    draft.rightPanelOrder,
  )
  return savedAsr
}