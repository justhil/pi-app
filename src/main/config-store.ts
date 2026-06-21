import pkg from 'electron-store'
const Store = pkg as any

interface StoreSchema {
  recentProjects: string[]
  currentProject: string | null
  windowBounds: { width: number; height: number; x?: number; y?: number } | null
  theme: 'light' | 'dark' | 'system'
  panelWidths: { sidebar: number; right: number } | null
  extensionOverrides: Record<string, boolean>
  /** Skill 启用：key 为 skillStorageKey，false=禁用，缺省=启用 */
  skillOverrides: Record<string, boolean>
  extensionConfigs: Record<string, Record<string, unknown>>
  /** 右侧栏 Tab 显示开关 */
  rightPanelPrefs: Record<string, boolean>
  /** 右侧栏 Tab 顺序（panel id 列表） */
  rightPanelOrder: string[]
  /** 界面语言（设置保存后写入） */
  language: 'zh' | 'en'
  /** 启动时打开上次项目 */
  autoOpenLastProject: boolean
  /** 启动时检查适配器 registry 更新 */
  autoCheckRegistryUpdates: boolean
  /** 全局：用户提醒是否播放提示音 */
  alertSoundEnabled: boolean
  /** 全局：用户提醒是否使用系统通知 */
  alertNotificationEnabled: boolean
  /** 扩展弹窗需用户作答时提醒 */
  alertOnExtensionUi: boolean
  /** Agent 一轮结束（空闲）时提醒 */
  alertOnRunIdle: boolean
}

const store = new Store<StoreSchema>({
  projectName: 'pi-desktop',
  defaults: {
    recentProjects: [],
    currentProject: null,
    windowBounds: null,
    theme: 'system',
    panelWidths: null,
    extensionOverrides: {},
    skillOverrides: {},
    extensionConfigs: {},
    rightPanelPrefs: {
      review: true,
      'adapter:trellis': true,
      run: true,
      context: true,
      intercom: true,
      tree: true,
    },
    rightPanelOrder: [],
    language: 'zh',
    autoOpenLastProject: true,
    autoCheckRegistryUpdates: true,
    alertSoundEnabled: true,
    alertNotificationEnabled: true,
    alertOnExtensionUi: true,
    alertOnRunIdle: true,
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
    const recent = store.get('recentProjects').filter((p) => p !== path)
    recent.unshift(path)
    store.set('recentProjects', recent.slice(0, 10))
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
