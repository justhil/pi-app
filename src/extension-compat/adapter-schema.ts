// adapter.json schema types & loader (兼容层 v2 — 见 doc/adapter-layer-plan.md)
// 声明式适配器：一个 JSON 描述插件的匹配、配置页、工具卡、交互 UI 长相。

export type AdapterTier = 'native' | 'partial' | 'headless' | 'none'

export type FieldType = 'text' | 'secret' | 'select' | 'number' | 'boolean'

export interface AdapterI18nLocale {
  displayName?: string
  description?: string
  note?: string
  fieldLabels?: Record<string, string>
  fieldDescriptions?: Record<string, string>
  actionLabels?: Record<string, string>
  sidePanel?: { label?: string; description?: string }
}

export interface SectionI18nLocale {
  title?: string
}

export interface ConfigField {
  key: string
  type: FieldType
  label?: string
  description?: string
  default?: unknown
  options?: string[] // for select (static)
  /** Dynamic options for select: fetch from an endpoint using ${field} templating (env-aware view values). */
  optionsFrom?: {
    url: string
    headers?: Record<string, string>
    itemsPath: string // JSONPath into response, e.g. "data" → array of strings or {id}
    valueFrom?: string // if items are objects, which key is the value (default "id")
    labelFrom?: string // if items are objects, which key is the label (default same as value)
    timeoutMs?: number
  }
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
  i18n?: Record<string, SectionI18nLocale>
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
  /** Form keys stored in app-local configStore instead of the shared file (desktop-only UI toggles). */
  localKeys?: string[]
  /** When set, the entire config value (or a named field) reads/writes ~/.pi/agent/settings.json under this key.
   *  Used for pi flag-backed adapter settings (e.g. fff-mode). */
  piSettingsKey?: string
  sections?: ConfigSection[]
  actions?: AdapterAction[]
  note?: string
  /** Hint for a specialized renderer (e.g. skills-manager / mcp-diagnostics) instead of generic sections. */
  customRenderer?: string
  i18n?: Record<string, { note?: string }>
}

export type ToolCardTemplate = 'default' | 'list' | 'media' | 'tree' | 'kv' | 'hashline'

export interface ToolCardDef {
  template?: ToolCardTemplate
  /** 输出协议（如 hashline-v1），由 extension-compat/renderer 解释，不绑定包名 */
  protocol?: string
  statusField?: string // JSONPath into tool_execution_update, e.g. "$.output.text"
  icon?: string // lucide icon name
  fields?: Record<string, string> // template field -> JSONPath
}

export interface InteractDef {
  trigger: { tool?: string; argsMatch?: Record<string, unknown> }
  schema: 'questions' | 'clarify' | 'review'
  /** Map dialog field → tool-arg JSONPath (e.g. "image": "$.image"). */
  fields?: Record<string, string>
}

export interface AdapterSlash {
  [command: string]: 'notify' | 'config-page' | 'execute' | 'open-panel'
}

/** 声明右栏 Tab：设置页自动出现开关；slash open-panel 可打开。 */
export interface AdapterSidePanel {
  /** main/side-panel-registry.ts 中的状态提供者 */
  stateProvider: string
  /** 渲染器键：workspace-tasks、generic-json 等（见 side-panel-registry） */
  panelComponent: string
  /** Tab / prefs 键；默认 adapter:{id} */
  panelId?: string
  label?: string
  description?: string
  /** lucide 图标名 */
  icon?: string
  defaultEnabled?: boolean
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
  sidePanel?: AdapterSidePanel
  /** 不依赖 npm 安装即可生效（如 trellis 靠项目 .trellis/ 目录） */
  alwaysVisible?: boolean
  i18n?: Record<string, AdapterI18nLocale>
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

// ── i18n resolver (renderer-safe, no fs deps) ──

export interface ResolvedAdapterText {
  displayName?: string
  description?: string
  note?: string
  sections: Array<{ title?: string; fields: ConfigField[] }>
  actions: Array<{ id: string; label?: string }>
  sidePanel: { label?: string; description?: string }
}

export function resolveAdapterText(a: AdapterJson, language: string): ResolvedAdapterText {
  const lang = language.slice(0, 2)
  const loc = a.i18n?.[language] || a.i18n?.[lang] || {}
  return {
    displayName: loc.displayName ?? a.displayName,
    description: loc.description ?? a.description,
    note: a.config?.i18n?.[language]?.note ?? a.config?.i18n?.[lang]?.note ?? loc.note ?? a.config?.note,
    sections: (a.config?.sections ?? []).map((s) => ({
      title: s.i18n?.[language]?.title ?? s.i18n?.[lang]?.title ?? s.title,
      fields: (s.fields ?? []).map((f) => ({
        ...f,
        label: loc.fieldLabels?.[f.key] ?? f.label,
        description: loc.fieldDescriptions?.[f.key] ?? f.description,
      })),
    })),
    actions: (a.config?.actions ?? []).map((act) => ({
      id: act.id,
      label: loc.actionLabels?.[act.id] ?? act.label,
    })),
    sidePanel: {
      label: loc.sidePanel?.label ?? a.sidePanel?.label,
      description: loc.sidePanel?.description ?? a.sidePanel?.description,
    },
  }
}
