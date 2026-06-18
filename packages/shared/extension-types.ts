// Extension types - Compatibility levels and adapter interfaces

export type CompatibilityLevel = 'native' | 'basic' | 'headless' | 'blocked'

export interface PluginRendererMap {
  [rendererId: string]: string // rendererId → component key
}

export interface DesktopPluginAdapter {
  id: string
  displayName: string
  compatibility: CompatibilityLevel
  configSchema?: Record<string, unknown> // JSON Schema
  defaultConfig?: Record<string, unknown>
  renderers?: PluginRendererMap
}

// Remote registry entry
export interface RemoteAdapterEntry {
  id: string
  displayName: string
  compatibility: CompatibilityLevel
  match: {
    tools?: string[]
    commands?: string[]
  }
  versionRange?: string
  rendererMap?: PluginRendererMap
  configSchema?: Record<string, unknown>
  defaultConfig?: Record<string, unknown>
  risk?: {
    level: 'low' | 'medium' | 'high'
    message: string
  }
  docsUrl?: string
}

// Registry file structure
export interface RegistryFile {
  version: string
  minAppVersion?: string
  adapters: RemoteAdapterEntry[]
}

// Extension info reported by probe
export interface ExtensionProbeResult {
  extensionId: string
  source: string
  registeredTools: string[]
  registeredCommands: string[]
  loadError?: string
}

// Built-in renderer registry
export interface BuiltinRenderer {
  rendererId: string
  componentKey: string
}
