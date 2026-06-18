import pkg from 'electron-store'
const Store = pkg as any

interface StoreSchema {
  recentProjects: string[]
  currentProject: string | null
  windowBounds: { width: number; height: number; x?: number; y?: number } | null
  theme: 'light' | 'dark' | 'system'
  panelWidths: { sidebar: number; right: number } | null
  extensionOverrides: Record<string, boolean>
  extensionConfigs: Record<string, Record<string, unknown>>
  registryLastCheck: number | null
}

const store = new Store<StoreSchema>({
  defaults: {
    recentProjects: [],
    currentProject: null,
    windowBounds: null,
    theme: 'system',
    panelWidths: null,
    extensionOverrides: {},
    extensionConfigs: {},
    registryLastCheck: null,
  },
})

export const configStore = {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K] {
    return store.get(key)
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

  getExtensionConfig(workspaceId: string, extensionId: string): Record<string, unknown> | undefined {
    const key = `${workspaceId}:${extensionId}`
    return store.get('extensionConfigs')[key]
  },

  setExtensionConfig(workspaceId: string, extensionId: string, config: Record<string, unknown>): void {
    const configs = store.get('extensionConfigs')
    configs[`${workspaceId}:${extensionId}`] = config
    store.set('extensionConfigs', configs)
  },
}
