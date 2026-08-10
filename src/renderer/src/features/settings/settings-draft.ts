import type { i18n as I18n } from 'i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { applyIconTheme } from '@renderer/components/icons'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AsrConfig } from '@shared/asr-types'
import { normalizeIconTheme, type IconTheme } from '@shared/icon-theme'
import {
  type CustomCssOverride,
  type CustomTheme,
  normalizeCustomCssOverride,
  normalizeCustomTheme,
} from '@shared/custom-theme'
import { injectCustomCssOverride } from '@renderer/lib/theme/inject-custom-css'
import { applyCustomTheme } from '@renderer/lib/theme/inject-theme'
import { normalizeTimelineMaxAutoExpandedTools } from '@shared/timeline-settings'
import {
  normalizeRightPanelOrder,
  normalizeRightPanelPrefs,
  type RightPanelCatalogItem,
  type RightPanelPrefs,
} from '@shared/right-panels'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type LanguageChoice = 'zh' | 'en'

export type AgentRuntimeChoice = { mode: 'host' | 'wsl'; distro: string | null }

export type SettingsDraft = {
  theme: ThemeChoice
  iconTheme: IconTheme
  customTheme: CustomTheme
  customCssOverride: CustomCssOverride
  language: LanguageChoice
  autoOpenLastProject: boolean
  autoCheckRegistryUpdates: boolean
  alertSoundEnabled: boolean
  alertNotificationEnabled: boolean
  alertOnExtensionUi: boolean
  alertOnRunIdle: boolean
  alertOnBackgroundRunIdle: boolean
  maxSessionWorkers: number
  sessionWorkerIdleTimeoutMinutes: number
  timelineMaxAutoExpandedTools: number
  showNonMessageEntries: boolean
  extensionOverrides: Record<string, boolean>
  rightPanelCatalog: RightPanelCatalogItem[]
  rightPanelPrefs: RightPanelPrefs
  rightPanelOrder: string[]
  asrConfig: AsrConfig
  agentRuntime: AgentRuntimeChoice
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

export function normalizeAgentRuntime(raw: unknown): AgentRuntimeChoice {
  const r = (raw || {}) as { mode?: unknown; distro?: unknown }
  if (r.mode === 'wsl') {
    const distro = typeof r.distro === 'string' && r.distro.trim() ? r.distro.trim() : null
    return { mode: 'wsl', distro }
  }
  return { mode: 'host', distro: null }
}

export function draftSignature(d: SettingsDraft): string {
  return JSON.stringify({
    theme: d.theme,
    iconTheme: d.iconTheme,
    customTheme: d.customTheme,
    customCssOverride: d.customCssOverride,
    language: d.language,
    autoOpenLastProject: d.autoOpenLastProject,
    autoCheckRegistryUpdates: d.autoCheckRegistryUpdates,
    alertSoundEnabled: d.alertSoundEnabled,
    alertNotificationEnabled: d.alertNotificationEnabled,
    alertOnExtensionUi: d.alertOnExtensionUi,
    alertOnRunIdle: d.alertOnRunIdle,
    alertOnBackgroundRunIdle: d.alertOnBackgroundRunIdle,
    maxSessionWorkers: d.maxSessionWorkers,
    sessionWorkerIdleTimeoutMinutes: d.sessionWorkerIdleTimeoutMinutes,
    timelineMaxAutoExpandedTools: d.timelineMaxAutoExpandedTools,
    showNonMessageEntries: d.showNonMessageEntries,
    extensionOverrides: d.extensionOverrides,
    rightPanelPrefs: d.rightPanelPrefs,
    rightPanelOrder: d.rightPanelOrder,
    asrConfig: normalizeAsrForSignature(d.asrConfig),
    agentRuntime: d.agentRuntime,
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
    theme: normalizeThemeChoice(s.theme),
    iconTheme: normalizeIconTheme(s.iconTheme),
    customTheme: normalizeCustomTheme(s.customTheme),
    customCssOverride: normalizeCustomCssOverride(s.customCssOverride),
    language: normalizeLanguage(s.language, normalizeLanguage(i18nLanguage, 'zh')),
    autoOpenLastProject: s.autoOpenLastProject !== false,
    autoCheckRegistryUpdates: s.autoCheckRegistryUpdates !== false,
    alertSoundEnabled: s.alertSoundEnabled !== false,
    alertNotificationEnabled: s.alertNotificationEnabled !== false,
    alertOnExtensionUi: s.alertOnExtensionUi !== false,
    alertOnRunIdle: s.alertOnRunIdle !== false,
    alertOnBackgroundRunIdle: s.alertOnBackgroundRunIdle === true,
    maxSessionWorkers: normalizeMaxSessionWorkersUi(s.maxSessionWorkers),
    sessionWorkerIdleTimeoutMinutes: normalizeIdleTimeoutMinutesUi(s.sessionWorkerIdleTimeoutMinutes),
    timelineMaxAutoExpandedTools: normalizeTimelineMaxAutoExpandedTools(s.timelineMaxAutoExpandedTools),
    showNonMessageEntries: s.showNonMessageEntries === true,
    extensionOverrides: { ...(s.extensionOverrides || {}) },
    rightPanelCatalog: cat,
    rightPanelPrefs: prefs,
    rightPanelOrder: order,
    asrConfig: asrConfigFromSettingsResponse((s.asrConfig || {}) as AsrConfig),
    agentRuntime: normalizeAgentRuntime(s.agentRuntime),
  }
}

let appliedThemeChoice: ThemeChoice = 'system'

export function applyThemeToDocument(theme: ThemeChoice): void {
  appliedThemeChoice = theme
  if (theme === 'dark') document.documentElement.classList.add('dark')
  else if (theme === 'light') document.documentElement.classList.remove('dark')
  else {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', isDark)
  }
}

function normalizeThemeChoice(raw: unknown): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

export function normalizeMaxSessionWorkersUi(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 4
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

export function normalizeIdleTimeoutMinutesUi(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return 15
  if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  return n
}

/**
 * Load theme from electron-store (settings) and apply to document + ui-store.
 * Source of truth is settings; localStorage (pi-desktop-ui) is only an anti-FOUC cache.
 */
export async function hydrateThemeFromSettings(): Promise<void> {
  const res = await ipcClient.invoke('settings.get', { key: 'theme' }).catch(() => ({ settings: {} }))
  const theme = normalizeThemeChoice(res?.settings?.theme)
  useUIStore.getState().setTheme(theme)
  applyThemeToDocument(theme)
}

/**
 * 自定义主题水合：electron-store 是真源，localStorage 镜像只服务首帧脚本。
 * 缓存与真源不一致时以真源重算覆盖。
 */
export async function hydrateCustomThemeFromSettings(): Promise<void> {
  const res = await ipcClient
    .invoke('settings.get', { key: 'customTheme' })
    .catch(() => ({ settings: {} }))
  applyCustomTheme(normalizeCustomTheme(res?.settings?.customTheme))
}

export async function hydrateCustomCssOverrideFromSettings(): Promise<void> {
  const res = await ipcClient
    .invoke('settings.get', { key: 'customCssOverride' })
    .catch(() => ({ settings: {} }))
  injectCustomCssOverride(normalizeCustomCssOverride(res?.settings?.customCssOverride))
}

/** system 模式下跟随 OS 明暗切换；返回取消订阅 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (appliedThemeChoice === 'system') {
      document.documentElement.classList.toggle('dark', mq.matches)
    }
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** 仅界面预览，不写盘 */
export function previewDraftUi(draft: SettingsDraft, i18n: I18n): void {
  applyThemeToDocument(draft.theme)
  applyIconTheme(draft.iconTheme)
  applyCustomTheme(draft.customTheme)
  injectCustomCssOverride(draft.customCssOverride)
  if (i18n.language !== draft.language) void i18n.changeLanguage(draft.language)
}

export async function commitSettingsDraft(draft: SettingsDraft, i18n: I18n): Promise<AsrConfig> {
  await ipcClient.invoke('settings.set', { key: 'theme', value: draft.theme })
  await ipcClient.invoke('settings.set', { key: 'iconTheme', value: draft.iconTheme })
  await ipcClient.invoke('settings.set', {
    key: 'customTheme',
    value: draft.customTheme.light || draft.customTheme.dark ? draft.customTheme : null,
  })
  await ipcClient.invoke('settings.set', { key: 'customCssOverride', value: draft.customCssOverride })
  await ipcClient.invoke('settings.set', { key: 'language', value: draft.language })
  await ipcClient.invoke('settings.set', { key: 'autoOpenLastProject', value: draft.autoOpenLastProject })
  await ipcClient.invoke('settings.set', { key: 'autoCheckRegistryUpdates', value: draft.autoCheckRegistryUpdates })
  await ipcClient.invoke('settings.set', { key: 'alertSoundEnabled', value: draft.alertSoundEnabled })
  await ipcClient.invoke('settings.set', { key: 'alertNotificationEnabled', value: draft.alertNotificationEnabled })
  await ipcClient.invoke('settings.set', { key: 'alertOnExtensionUi', value: draft.alertOnExtensionUi })
  await ipcClient.invoke('settings.set', { key: 'alertOnRunIdle', value: draft.alertOnRunIdle })
  await ipcClient.invoke('settings.set', {
    key: 'alertOnBackgroundRunIdle',
    value: draft.alertOnBackgroundRunIdle,
  })
  await ipcClient.invoke('settings.set', {
    key: 'maxSessionWorkers',
    value: normalizeMaxSessionWorkersUi(draft.maxSessionWorkers),
  })
  await ipcClient.invoke('settings.set', {
    key: 'sessionWorkerIdleTimeoutMinutes',
    value: normalizeIdleTimeoutMinutesUi(draft.sessionWorkerIdleTimeoutMinutes),
  })
  await ipcClient.invoke('settings.set', {
    key: 'timelineMaxAutoExpandedTools',
    value: draft.timelineMaxAutoExpandedTools,
  })
  await ipcClient.invoke('settings.set', {
    key: 'showNonMessageEntries',
    value: draft.showNonMessageEntries,
  })
  await ipcClient.invoke('settings.set', { key: 'extensionOverrides', value: draft.extensionOverrides })
  await ipcClient.invoke('rightPanels.saveLayout', {
    prefs: draft.rightPanelPrefs,
    order: draft.rightPanelOrder,
  })

  const asrRes = await ipcClient.invoke('settings.set', { key: 'asrConfig', value: draft.asrConfig })
  const savedAsr = asrConfigFromSettingsResponse((asrRes?.value || draft.asrConfig) as AsrConfig)
  draft.asrConfig = savedAsr

  await ipcClient.invoke('settings.set', { key: 'agentRuntime', value: draft.agentRuntime })

  useUIStore.getState().setTheme(draft.theme)
  applyIconTheme(draft.iconTheme)
  useUIStore.getState().setTimelineMaxAutoExpandedTools(draft.timelineMaxAutoExpandedTools)
  useUIStore.getState().setShowNonMessageEntries(draft.showNonMessageEntries)
  applyThemeToDocument(draft.theme)
  applyCustomTheme(draft.customTheme)
  injectCustomCssOverride(draft.customCssOverride)
  if (i18n.language !== draft.language) await i18n.changeLanguage(draft.language)
  useUIStore.getState().applyRightPanelRuntime(
    draft.rightPanelCatalog,
    draft.rightPanelPrefs,
    draft.rightPanelOrder,
  )
  return savedAsr
}