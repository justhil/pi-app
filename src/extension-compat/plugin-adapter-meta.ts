// Per-plugin desktop adapter metadata (1:1 with installed extension package name)

export type PluginAdapterTier = 'native' | 'partial' | 'headless' | 'none'
export type SlashBehavior = 'notify' | 'config-page' | 'execute'

export interface ConfigKey {
  key: string
  type: 'boolean' | 'number' | 'string'
  label?: string
  description?: string
  default?: unknown
  /** If true, this key is informational only; not editable here. */
  readOnly?: boolean
}

export interface PluginAdapterMeta {
  /** npm / folder name keys (exact or suffix match) */
  matchNames: string[]
  desktopSupport: string
  tier: PluginAdapterTier
  /** Optional version notes for adapter implementation */
  adapterVersion?: string
  notes?: string
  /** Commands that open a TUI config page in pi -> route to desktop adapter config page */
  configPageCommands?: string[]
  /** Per-command desktop behavior. Defaults to 'notify' for command-only plugins. */
  slashBehavior?: Record<string, SlashBehavior>
  /** Declared editable config keys (R0-3). If absent, config subpage shows an explanatory note instead of fake fields. */
  configKeys?: ConfigKey[]
  /** Human-readable note shown when no configKeys are declared */
  configNote?: string
}

const META: PluginAdapterMeta[] = [
  {
    matchNames: ['trellis'],
    tier: 'native',
    adapterVersion: '1',
    desktopSupport: 'Trellis 只读面板 + trellis_subagent 工具卡片',
    configKeys: [
      { key: 'showRecentJournal', type: 'boolean', label: '显示最近日志', default: true },
      { key: 'journalLimit', type: 'number', label: '日志条数上限', default: 5 },
    ],
  },
  {
    matchNames: ['@juicesharp/rpiv-ask-user-question', 'rpiv-ask-user-question'],
    tier: 'native',
    adapterVersion: '1',
    desktopSupport: 'Extension UI 桥 + 桌面问卷（简化版，无 TUI preview 并排）',
  },
  {
    matchNames: ['pi-cache-optimizer'],
    tier: 'headless',
    desktopSupport: '缓存优化开关；斜杠输出状态提示',
    slashBehavior: { '/cache-optimizer': 'config-page' },
    configKeys: [
      { key: 'enabled', type: 'boolean', label: '启用桌面缓存提示', default: true },
    ],
    configNote: '缓存优化逻辑由扩展自管；此处仅控制桌面状态提示开关，不影响扩展行为。',
  },
  {
    matchNames: ['@agnishc/edb-context-viewer'],
    tier: 'headless',
    desktopSupport: '上下文查看器；斜杠输出只读说明',
    slashBehavior: { '/context': 'notify' },
  },
  {
    matchNames: ['@vanillagreen/pi-skills-manager'],
    tier: 'headless',
    desktopSupport: '技能管理；/skill 走适配器配置页',
    configPageCommands: ['/skill', '/skill:enable'],
    slashBehavior: { '/skill': 'config-page', '/skill:enable': 'notify' },
  },
  {
    matchNames: ['@ff-labs/pi-fff'],
    tier: 'headless',
    desktopSupport: 'FFF 模糊搜索开关；斜杠输出状态',
    slashBehavior: { '/fff-mode': 'notify', '/fff-health': 'notify', '/fff-rescan': 'notify' },
  },
  {
    matchNames: ['pi-fast-context'],
    tier: 'headless',
    desktopSupport: 'fast_context_search 可执行；桌面显示通用工具输出，配置命令仅提示/路由',
    slashBehavior: {
      '/fast-context-status': 'notify',
      '/fast-context-config': 'config-page',
      '/fast-context-import-key': 'notify',
    },
    configNote: 'Fast Context 配置由扩展维护（~/.pi/agent/fast-context.json / 环境变量 / Windsurf 自动发现）；桌面不写入该配置。',
  },
  {
    matchNames: ['@narumitw/pi-sync'],
    tier: 'headless',
    desktopSupport: '配置同步；斜杠输出状态',
    slashBehavior: { '/pisync': 'notify' },
  },
  {
    matchNames: ['pi-markdown-preview'],
    tier: 'partial',
    desktopSupport: 'preview_export 工具结果展示；无内置 Markdown 预览面板',
    slashBehavior: {
      '/preview': 'notify',
      '/preview-browser': 'notify',
      '/preview-pdf': 'notify',
      '/preview-clear-cache': 'notify',
    },
  },
  {
    matchNames: ['pi-studio'],
    tier: 'partial',
    desktopSupport: '导出/REPL 工具可执行；无 tmux Studio 双栏与 REPL 终端',
    configPageCommands: ['/studio', '/studio-replace', '/studio-editor-only'],
    slashBehavior: {
      '/studio': 'config-page',
      '/studio-replace': 'config-page',
      '/studio-editor-only': 'config-page',
      '/studio-pdf': 'notify',
      '/studio-html': 'notify',
      '/studio-current': 'notify',
    },
  },
  {
    matchNames: ['pi-multimodal-proxy'],
    tier: 'partial',
    desktopSupport: 'analyze_image 工具卡片；无完整 vision TUI',
    configKeys: [
      { key: 'showInlinePreview', type: 'boolean', label: '时间线内联图像预览（输入图路径）', default: true },
    ],
    configNote: '多模态代理由扩展自管；此处仅控制桌面卡片展示。',
    slashBehavior: { '/multimodal-proxy': 'notify', '/vision-proxy': 'notify' },
  },
  {
    matchNames: ['pi-image-gen'],
    tier: 'partial',
    desktopSupport: 'image_gen / image_review 工具卡片；无完整 image_gen TUI',
    configKeys: [
      { key: 'showInlinePreview', type: 'boolean', label: '时间线内联图像预览', default: true },
    ],
    configNote: '生图由扩展工具驱动；此处仅控制桌面卡片内联预览与打开按钮。',
  },
  {
    matchNames: ['pi-intercom'],
    tier: 'headless',
    desktopSupport: 'intercom / contact_supervisor 可执行；无 Intercom 专用 UI',
    slashBehavior: { '/intercom': 'notify' },
  },
  {
    matchNames: ['pi-subagents'],
    tier: 'headless',
    desktopSupport: 'subagent 可执行；子代理 TUI 澄清未适配',
  },
  {
    matchNames: ['pi-rewind'],
    tier: 'headless',
    desktopSupport: '检查点/回溯；斜杠输出状态',
    slashBehavior: { '/rewind': 'notify' },
  },
  {
    matchNames: ['pi-continue'],
    tier: 'headless',
    desktopSupport: '中途续跑；斜杠输出状态',
    slashBehavior: { '/continue': 'notify' },
  },
  {
    matchNames: ['pi-goal'],
    tier: 'headless',
    desktopSupport: '目标循环；斜杠输出状态',
    slashBehavior: { '/goal': 'notify' },
  },
  {
    matchNames: ['pi-btw'],
    tier: 'headless',
    desktopSupport: '并行侧聊；斜杠输出状态',
    slashBehavior: {
      '/btw': 'notify', '/btw:tangent': 'notify', '/btw:new': 'notify',
      '/btw:clear': 'notify', '/btw:inject': 'notify', '/btw:summarize': 'notify',
      '/btw:model': 'notify', '/btw:thinking': 'notify',
    },
  },
  {
    matchNames: ['pi-simplify'],
    tier: 'headless',
    desktopSupport: '代码精简审查；无斜杠入口，由工具触发',
  },
  {
    matchNames: ['@juicesharp/rpiv-advisor'],
    tier: 'headless',
    desktopSupport: '第二意见；无斜杠入口，由工具触发',
  },
  {
    matchNames: ['pi-observational-memory'],
    tier: 'headless',
    desktopSupport: '观察记忆；无斜杠入口，自动生效',
  },
  {
    matchNames: ['pi-tool-display'],
    tier: 'headless',
    desktopSupport: '工具显示紧凑化；无桌面等价（TUI 专用）',
  },
  {
    matchNames: ['pi-agentsmd'],
    tier: 'headless',
    desktopSupport: 'AGENTS.md 生成；无斜杠入口',
  },
  {
    matchNames: ['pi-mcp-adapter'],
    tier: 'headless',
    desktopSupport: 'MCP 适配器；工具可执行',
    configNote: '连接与服务器配置由扩展在 pi/TUI 自管；桌面配置页仅展示诊断说明。',
  },
  {
    matchNames: ['@kinarajv/pi-tps-extensions'],
    tier: 'none',
    desktopSupport: '仅 TUI 页脚/token 显示；桌面无对应组件',
  },
  {
    matchNames: ['pi-nano-context'],
    tier: 'none',
    desktopSupport: 'TUI 编辑器下方的上下文进度条；桌面无对应组件',
  },
  {
    matchNames: ['pi-powerline-footer'],
    tier: 'none',
    desktopSupport: 'Powerline 样式页脚状态栏；桌面无对应组件',
    slashBehavior: {
      '/powerline': 'notify', '/stash-history': 'notify',
      '/bash-mode': 'notify', '/bash-reset': 'notify', '/vibe': 'notify',
    },
  },
  {
    matchNames: ['amp-themes'],
    tier: 'none',
    desktopSupport: 'Amp 风格主题/编辑器装饰；桌面无对应组件',
  },
  {
    matchNames: ['pi-ace-tool'],
    tier: 'headless',
    desktopSupport: 'ACE 工具扩展；工具随扩展加载执行，无桌面专属 UI',
    configNote: 'ACE 工具行为由扩展自管；桌面仅执行其注册的工具。',
  },
  {
    matchNames: ['@feniix/pi-sequential-thinking'],
    tier: 'headless',
    desktopSupport: 'sequential thinking 工具；阶段/思考链默认以通用工具卡展示',
    configNote: '思考链数据由扩展工具输出；桌面按工具结果渲染。',
  },
  {
    matchNames: ['Aegis', 'GanyuanRan/Aegis'],
    tier: 'headless',
    desktopSupport: 'Aegis 工作流扩展集；工具/技能随包加载，复用通用与 trellis 卡',
    configNote: 'Aegis 能力由其扩展与技能集合定义；桌面按已注册工具渲染。',
  },
  {
    matchNames: ['@victor-software-house/pi-curated-themes', 'pi-curated-themes'],
    tier: 'none',
    desktopSupport: 'pi 终端主题包；桌面用独立 Appearance 设置，不复刻终端主题',
  },
  {
    matchNames: ['@firstpick/pi-themes-bundle', 'pi-themes-bundle'],
    tier: 'none',
    desktopSupport: 'pi 终端主题 bundle；桌面用独立 Appearance 设置，主题资源在 Resources 只读列表',
  },
]

function norm(s: string): string {
  return s.toLowerCase().replace(/^package:/, '')
}

export function resolvePluginAdapterMeta(name: string, packageName?: string): PluginAdapterMeta | null {
  const candidates = [name, packageName].filter(Boolean) as string[]
  for (const c of candidates) {
    const n = norm(c)
    for (const m of META) {
      if (m.matchNames.some((k) => norm(k) === n || n.endsWith(norm(k)) || n.includes(norm(k)))) {
        return m
      }
    }
  }
  return null
}

import { resolveV2Slash } from './adapter-loader'

/** Resolve slash behavior for a given command name (e.g. /studio). Returns null if no adapter claims it. */
export function resolveSlashBehavior(commandName: string): { meta: PluginAdapterMeta; behavior: SlashBehavior } | null {
  // v2 adapter.json takes precedence (per docs/adapter-layer-plan.md)
  const v2 = resolveV2Slash(commandName)
  if (v2) {
    return {
      meta: {
        matchNames: v2.matchNames,
        tier: 'partial',
        desktopSupport: v2.desktopSupport || '',
      } as PluginAdapterMeta,
      behavior: v2.behavior,
    }
  }
  const cmd = commandName.startsWith('/') ? commandName : `/${commandName}`
  for (const m of META) {
    if (m.slashBehavior && m.slashBehavior[cmd]) {
      return { meta: m, behavior: m.slashBehavior[cmd] }
    }
  }
  // configPageCommands default to 'config-page'
  for (const m of META) {
    if (m.configPageCommands?.includes(cmd)) {
      return { meta: m, behavior: 'config-page' }
    }
  }
  return null
}

