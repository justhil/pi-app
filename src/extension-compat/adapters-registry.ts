// Canonical adapter catalog: tool/command → desktop adapter (single source of truth)

export type AdapterTier = 'native' | 'partial' | 'headless' | 'none'

export interface AdapterDefinition {
  id: string
  displayName: string
  description: string
  /** Tools that map to this adapter (exclusive ownership per tool in TOOL_TO_ADAPTER) */
  tools: string[]
  /** Optional slash commands (prefix match without leading /) */
  commandPrefixes?: string[]
  tier: AdapterTier
  /** What the desktop app actually does today */
  desktopSupport: string
}

/** One tool name → exactly one adapter id */
export const TOOL_TO_ADAPTER: Record<string, string> = {
  trellis_subagent: 'trellis',
  ask_user_question: 'ask',
  image_gen: 'image',
  image_review: 'image',
  analyze_image: 'image',
  preview_export: 'doc',
  studio_export_pdf: 'doc',
  studio_export_html: 'doc',
  studio_repl_status: 'repl',
  studio_repl_send: 'repl',
  intercom: 'intercom',
  contact_supervisor: 'intercom',
  subagent: 'subagent',
  fast_context_search: 'fast-context',
  search: 'pi-search',
  search_sources: 'pi-search',
  search_config: 'pi-search',
  context7_resolve_library_id: 'pi-search',
  context7_query_docs: 'pi-search',
  context7_get_library_docs: 'pi-search',
  context7_get_cached_doc_raw: 'pi-search',
  docs_search: 'pi-search',
  web_fetch: 'pi-search',
  web_map: 'pi-search',
  search_planning: 'pi-search',
  plan_intent: 'pi-search',
  plan_complexity: 'pi-search',
  plan_sub_query: 'pi-search',
  plan_search_term: 'pi-search',
  plan_tool_mapping: 'pi-search',
  plan_execution: 'pi-search',
}

export const ADAPTERS: Record<string, AdapterDefinition> = {
  trellis: {
    id: 'trellis',
    displayName: 'Trellis',
    description: 'Trellis 子代理进度与任务状态（只读面板 + 工具卡片）',
    tools: ['trellis_subagent'],
    tier: 'native',
    desktopSupport: '右栏 Trellis 只读；timeline 可解析 trellis_subagent 结果',
  },
  ask: {
    id: 'ask',
    displayName: 'Ask User Question',
    description: '@juicesharp/rpiv-ask-user-question 结构化问卷',
    tools: ['ask_user_question'],
    tier: 'native',
    desktopSupport: 'Worker 注入 uiContext；ExtensionUIHost 桌面问卷（简化版，无 TUI preview 并排）',
  },
  image: {
    id: 'image',
    displayName: 'Image / Vision',
    description: '生图、审图与多模态图像分析',
    tools: ['image_gen', 'image_review', 'analyze_image'],
    tier: 'partial',
    desktopSupport: '工具输出卡片；无完整 image_gen TUI 流程',
  },
  doc: {
    id: 'doc',
    displayName: 'Preview / Export',
    description: 'Markdown/LaTeX 预览与 PDF/HTML 导出',
    tools: ['preview_export', 'studio_export_pdf', 'studio_export_html'],
    commandPrefixes: ['preview', 'studio-pdf', 'studio-html', 'studio-export'],
    tier: 'partial',
    desktopSupport: '工具结果展示；无内置预览面板',
  },
  repl: {
    id: 'repl',
    displayName: 'Studio REPL',
    description: 'pi-studio tmux REPL 与导出',
    tools: ['studio_repl_status', 'studio_repl_send'],
    commandPrefixes: ['studio', 'studio-repl'],
    tier: 'partial',
    desktopSupport: '无 tmux REPL；导出类工具仅结果卡片',
  },
  intercom: {
    id: 'intercom',
    displayName: 'Intercom',
    description: 'pi-intercom 跨会话协调',
    tools: ['intercom', 'contact_supervisor'],
    commandPrefixes: ['intercom'],
    tier: 'headless',
    desktopSupport: '工具可执行；无专用 Intercom UI',
  },
  subagent: {
    id: 'subagent',
    description: 'pi-subagents 子代理委派与链路',
    displayName: 'Subagents',
    tools: ['subagent'],
    tier: 'headless',
    desktopSupport: '工具可执行；TUI 澄清对话框未适配',
  },
  'fast-context': {
    id: 'fast-context',
    displayName: 'Fast Context',
    description: 'pi-fast-context 语义代码搜索',
    tools: ['fast_context_search'],
    commandPrefixes: ['fast-context'],
    tier: 'headless',
    desktopSupport: '工具可执行；配置命令在桌面仅提示/路由，搜索结果走通用工具输出卡',
  },
  'pi-search': {
    id: 'pi-search',
    displayName: 'Pi Search',
    description: 'pi-search 网络/文档/Context7 搜索工具集',
    tools: [
      'search', 'search_sources', 'search_config',
      'context7_resolve_library_id', 'context7_query_docs', 'context7_get_library_docs', 'context7_get_cached_doc_raw',
      'docs_search', 'web_fetch', 'web_map', 'search_planning',
      'plan_intent', 'plan_complexity', 'plan_sub_query', 'plan_search_term', 'plan_tool_mapping', 'plan_execution',
    ],
    commandPrefixes: ['search', 'search-config', 'search-model', 'pi-ext-docs'],
    tier: 'headless',
    desktopSupport: '工具可执行；搜索配置/信源管理由扩展自管，桌面显示通用工具输出',
  },
  'ui-bridge': {
    id: 'ui-bridge',
    displayName: 'Extension UI 桥',
    description: '所有使用 ctx.ui 的扩展（通用）',
    tools: [],
    tier: 'partial',
    desktopSupport: 'bindExtensions + select/confirm/input/custom；非 per-plugin',
  },
}

export const ADAPTER_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(ADAPTERS).map((a) => [a.id, a.displayName]),
)

/** All adapter ids that claim a given tool */
export function adapterIdsForTools(toolNames: string[]): string[] {
  const ids = new Set<string>()
  for (const t of toolNames) {
    const id = TOOL_TO_ADAPTER[t]
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

export function getAdaptersCatalog(): AdapterDefinition[] {
  return Object.values(ADAPTERS).filter((a) => a.id !== 'ui-bridge')
}

/** Legacy single adapter: first by stable order */
export function primaryAdapterId(toolNames: string[]): string | undefined {
  const ids = adapterIdsForTools(toolNames)
  const order = ['trellis', 'ask', 'image', 'doc', 'repl', 'intercom', 'subagent', 'fast-context', 'pi-search']
  for (const id of order) {
    if (ids.includes(id)) return id
  }
  return ids[0]
}

export function tierToCompat(
  toolNames: string[],
  hasUI: boolean,
): 'native' | 'basic' | 'headless' | 'blocked' {
  const ids = adapterIdsForTools(toolNames)
  if (ids.length > 0) {
    const hasNative = ids.some((id) => ADAPTERS[id]?.tier === 'native')
    const hasPartial = ids.some((id) => ADAPTERS[id]?.tier === 'partial')
    if (hasNative) return 'native'
    if (hasPartial) return 'basic'
    return 'headless'
  }
  if (toolNames.length > 0 || hasUI) return hasUI ? 'basic' : 'headless'
  return 'headless'
}