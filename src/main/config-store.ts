import Store from 'electron-store'
import type { AsrConfig } from '@shared/asr-types'
import type { CustomCssOverride, CustomTheme } from '@shared/custom-theme'
import { DEFAULT_ICON_THEME, type IconTheme } from '@shared/icon-theme'
import { DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS } from '@shared/timeline-settings'
import { bindSecretStoreBacking } from './secret-store'
import { nextRecentProjects } from './recent-projects'

export interface StoreSchema {
  recentProjects: string[]
  /** 侧栏项目列表固定顺序（不随打开而置顶）；false = 最近使用排序（默认） */
  recentProjectsFixedOrder: boolean
  currentProject: string | null
  windowBounds: { width: number; height: number; x?: number; y?: number } | null
  theme: 'light' | 'dark' | 'system'
  iconTheme: IconTheme
  /** 自定义主题（浅/深各一槽，槽位缺省 = 未定制）；null = 完全未定制 */
  customTheme: CustomTheme | null
  /** 结构化主题之后的自由 CSS 覆盖层 */
  customCssOverride: CustomCssOverride
  panelWidths: { sidebar: number; right: number } | null
  extensionOverrides: Record<string, boolean>
  /** Skill 启用：key 为 skillStorageKey，false=禁用，缺省=启用 */
  skillOverrides: Record<string, boolean>
  /** Desktop-only skill alias/icon, keyed by skillCatalogKey */
  skillPresentation: Record<string, { alias?: string; icon?: string }>
  extensionConfigs: Record<string, Record<string, unknown>>
  /** 右侧栏 Tab 显示开关 */
  rightPanelPrefs: Record<string, boolean>
  /** 右侧栏 Tab 顺序（panel id 列表） */
  rightPanelOrder: string[]
  /** 界面语言（设置保存后写入） */
  language: 'zh' | 'en'
  /** 启动时打开上次项目 */
  autoOpenLastProject: boolean
  /** 启动时检查 GitHub Releases 是否有新版本 */
  autoCheckRegistryUpdates: boolean
  /** 上次自动更新检查时间戳（毫秒）；0 = 从未检查。用于避免每次启动都打 GitHub */
  lastUpdateCheckAt: number
  /** 用户选择「忽略本版本」的 semver（无 v 前缀）；空字符串 = 未忽略 */
  ignoredUpdateVersion: string
  /** 全局：用户提醒是否播放提示音 */
  alertSoundEnabled: boolean
  /** 全局：用户提醒是否使用系统通知 */
  alertNotificationEnabled: boolean
  /** 扩展弹窗需用户作答时提醒 */
  alertOnExtensionUi: boolean
  /** Agent 一轮结束（空闲）时提醒 */
  alertOnRunIdle: boolean
  /** 后台会话（非前台）run 结束时也提醒 */
  alertOnBackgroundRunIdle: boolean
  /** Agent 失败时提醒 */
  alertOnRunFailed: boolean
  completionNotificationTimeoutSeconds: number
  completionNotificationPreview: 'response' | 'fixed'
  completionNotificationOnlyWhenUnfocused: boolean
  completionNotificationDndUntil: number | null
  completionNotificationDelivery: 'auto' | 'custom' | 'system'
  /** 同时保留的会话/工作区 worker 进程上限 */
  maxSessionWorkers: number
  /** 空闲 worker 回收时间（分钟）；0 = 不因超时回收 */
  sessionWorkerIdleTimeoutMinutes: number
  /** 时间线当前 run 内同时自动展开的工具详情数量上限 */
  timelineMaxAutoExpandedTools: number
  /** 侧栏会话显示名，键为规范化后的 sessionFile 绝对路径 */
  sessionDisplayNames: Record<string, string>
  /** 语音输入 ASR 配置 */
  asrConfig: AsrConfig
  /** Agent 运行时：host = Windows 宿主，wsl = 在 WSL 发行版内运行 */
  agentRuntime: { mode: 'host' | 'wsl'; distro: string | null }
}

const store = new Store<StoreSchema>({
  name: 'pi-desktop',
  defaults: {
    recentProjects: [],
    recentProjectsFixedOrder: false,
    currentProject: null,
    windowBounds: null,
    theme: 'system',
    iconTheme: DEFAULT_ICON_THEME,
    customTheme: null,
    customCssOverride: { enabled: false, css: '' },
    panelWidths: null,
    extensionOverrides: {},
    skillOverrides: {},
    skillPresentation: {},
    extensionConfigs: {},
    rightPanelPrefs: {
      review: true,
      'adapter:trellis': true,
      run: true,
      context: true,
      intercom: false,
      tree: true,
    },
    rightPanelOrder: [],
    language: 'zh',
    autoOpenLastProject: true,
    autoCheckRegistryUpdates: true,
    lastUpdateCheckAt: 0,
    ignoredUpdateVersion: '',
    alertSoundEnabled: true,
    alertNotificationEnabled: true,
    alertOnExtensionUi: true,
    alertOnRunIdle: true,
    alertOnBackgroundRunIdle: false,
    alertOnRunFailed: true,
    completionNotificationTimeoutSeconds: 15,
    completionNotificationPreview: 'response',
    completionNotificationOnlyWhenUnfocused: true,
    completionNotificationDndUntil: null,
    completionNotificationDelivery: 'auto',
    maxSessionWorkers: 4,
    sessionWorkerIdleTimeoutMinutes: 15,
    timelineMaxAutoExpandedTools: DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
    sessionDisplayNames: {},
    asrConfig: {
      provider: 'codex-asr-builtin',
      language: 'auto',
      timeoutMs: 120000,
      builtinServePort: 18788,
    } as AsrConfig,
    agentRuntime: { mode: 'host', distro: null },
  },
})

bindSecretStoreBacking({
  get: (k) => store.get(k as keyof StoreSchema),
  set: (k, v) => store.set(k as keyof StoreSchema, v as StoreSchema[keyof StoreSchema]),
  delete: (k) => {
    const s = store as { delete?: (key: string) => void }
    if (typeof s.delete === 'function') s.delete(k)
  },
})

export const configStore = {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return store.get(key)
  },

  getAll(): Partial<StoreSchema> {
    return store.store
  },

  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
    store.set(key, value)
  },

  addRecentProject(path: string): void {
    store.set(
      'recentProjects',
      nextRecentProjects(store.get('recentProjects'), path, store.get('recentProjectsFixedOrder')),
    )
  },

  removeRecentProject(path: string): void {
    const recent = store.get('recentProjects').filter((p: string) => p !== path)
    store.set('recentProjects', recent)
  },

  setExtensionOverride(extensionId: string, enabled: boolean): void {
    const overrides = store.get('extensionOverrides')
    overrides[extensionId] = enabled
    store.set('extensionOverrides', overrides)
  },

  setSkillOverride(key: string, enabled: boolean): void {
    const overrides = { ...store.get('skillOverrides') }
    if (enabled) delete overrides[key]
    else overrides[key] = false
    store.set('skillOverrides', overrides)
  },

  getSkillOverrides(): Record<string, boolean> {
    return store.get('skillOverrides') || {}
  },

  getExtensionConfig(workspaceId: string, extensionId: string): Record<string, unknown> | undefined {
    const key = `${workspaceId}:${extensionId}`
    return store.get('extensionConfigs')[key]
  },

  setExtensionConfig(workspaceId: string, extensionId: string, config: Record<string, unknown>): void {
    const configs = store.get('extensionConfigs')
    configs[`${workspaceId}:${extensionId}`] = config
    store.set('extensionConfigs', configs)
  },

  /** 右侧栏开关与排序一次写入，避免分两次 set 导致只持久化一半 */
  setRightPanelLayout(prefs: Record<string, boolean>, order: string[]): void {
    store.set('rightPanelPrefs', prefs)
    store.set('rightPanelOrder', order)
  },
}
