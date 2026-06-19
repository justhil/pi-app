// adapter.json schema types & loader (兼容层 v2 — 见 docs/adapter-layer-plan.md)
// 声明式适配器：一个 JSON 描述插件的匹配、配置页、工具卡、交互 UI 长相。

export type AdapterTier = 'native' | 'partial' | 'headless' | 'none'

export type FieldType = 'text' | 'secret' | 'select' | 'number' | 'boolean'

export interface ConfigField {
  key: string
  type: FieldType
  label?: string
  description?: string
  default?: unknown
  options?: string[] // for select
  readOnly?: boolean
}

export interface DerivedRow {
  label: string
  available?: string // template: "${apiKeySet}"
  detail?: string // template: "openai:${apiKeySet ? 'on' : 'off'}"
}

export interface ConfigSection {
  title?: string
  fields?: ConfigField[]
  derived?: DerivedRow[] // statusGrid
}

export type ActionType = 'httpCheck' | 'openPath' | 'reload'

export interface AdapterAction {
  id: string
  type: ActionType
  label?: string
  method?: string // httpCheck
  url?: string // template
  headers?: Record<string, string> // template values
  body?: unknown
  timeoutMs?: number
  report?: { countPath?: string; label?: string }
}

export interface AdapterConfig {
  configFile?: string // shared-file path; omitted => app-local
  fileKeyMap?: Record<string, string> // form key -> file key
  envOverride?: Record<string, string> // form key -> env var name (read priority)
  sections?: ConfigSection[]
  actions?: AdapterAction[]
  note?: string
}

export type ToolCardTemplate = 'default' | 'list' | 'media' | 'tree' | 'kv'

export interface ToolCardDef {
  template?: ToolCardTemplate
  statusField?: string // JSONPath into tool_execution_update, e.g. "$.output.text"
  icon?: string // lucide icon name
  fields?: Record<string, string> // template field -> JSONPath
}

export interface InteractDef {
  trigger: { tool?: string; argsMatch?: Record<string, unknown> }
  schema: 'questions' | 'clarify'
  fields?: Record<string, string> // extract from tool args
}

export interface AdapterSlash {
  [command: string]: 'notify' | 'config-page' | 'execute'
}

export interface AdapterMatch {
  names?: string[]
  tools?: string[]
  commands?: string[]
}

export interface AdapterJson {
  $schema?: string
  id: string
  displayName?: string
  description?: string
  match: AdapterMatch
  tier: AdapterTier
  config?: AdapterConfig
  toolCard?: ToolCardDef
  interact?: InteractDef
  slash?: AdapterSlash
}

export interface AdapterLoadError {
  adapterId: string
  source: 'builtin' | 'override' | 'probe'
  message: string
}

export interface AdapterCatalog {
  adapters: AdapterJson[]
  errors: AdapterLoadError[]
  sources: Record<string, 'builtin' | 'override' | 'probe'>
}
