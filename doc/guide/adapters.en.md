<!-- AUTO-GENERATED — do not edit by hand -->

# Built-in extension adapters

**[简体中文](./adapters.zh-CN.md)**

Generated from `src/extension-compat/builtin/*.adapter.json` (34 adapters).

1. Install in terminal pi: `pi install npm:<name>` or `pi install git:...`
2. Enable in `~/.pi/agent/settings.json` → `packages`
3. Restart the desktop **worker session**

| Adapter | Package | Tier | Description |
|---------|---------|------|-------------|
| Aegis | [`Aegis`](https://www.npmjs.com/package/Aegis) | headless | Aegis 工作流扩展集（复用通用与 trellis 卡） |
| Amp Themes | [`amp-themes`](https://www.npmjs.com/package/amp-themes) | none | Amp theme loader/editor package; desktop-side adapter only |
| Context Viewer | `@agnishc/edb-context-viewer` | headless | 上下文查看器（斜杠输出只读说明） |
| ACE Tool | [`pi-ace-tool`](https://www.npmjs.com/package/pi-ace-tool) | headless | ACE tool capability manager; writes ~/.pi/agent/ace-tool.json + connectivity test |
| Agents.md | [`pi-agentsmd`](https://www.npmjs.com/package/pi-agentsmd) | headless | AGENTS.md generator; list and entry included |
| BTW | [`pi-btw`](https://www.npmjs.com/package/pi-btw) | headless | By-the-way insert model; list and status included |
| Cache Optimizer | [`pi-cache-optimizer`](https://www.npmjs.com/package/pi-cache-optimizer) | headless | Context cache optimizer; loaded at runtime, affects new session context |
| Continue | [`pi-continue`](https://www.npmjs.com/package/pi-continue) | headless | Mid-task continue; reads ~/.pi/agent/extensions/pi-continue.json |
| Curated Themes | `@victor-software-house/pi-curated-themes` | none | pi 终端主题包（桌面用独立 Appearance 设置） |
| Fast Context | [`pi-fast-context`](https://www.npmjs.com/package/pi-fast-context) | headless | Semantic context search; writes ~/.pi/agent/fast-context.json + connectivity test |
| FFF | `@ff-labs/pi-fff` | headless | 模糊路径搜索模式（读写 ~/.pi/agent/settings.json 的 fff-mode flag） |
| Goal | [`pi-goal`](https://www.npmjs.com/package/pi-goal) | headless | Goal loop manager; list and status included |
| Hashline Edit | `@jerryan/pi-hashline-edit` | partial | Hash-anchor read/edit/insert/grep; temporary file dedicated hashline preview |
| Image Gen | [`pi-image-gen`](https://www.npmjs.com/package/pi-image-gen) | partial | Image generation/editing tool; writes ~/.pi/agent/image-gen.json + connectivity test + model picker |
| Markdown Preview | [`pi-markdown-preview`](https://www.npmjs.com/package/pi-markdown-preview) | partial | Markdown/LaTeX preview and PDF/HTML export tool (screenshot + open file) |
| MCP Adapter | [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | headless | MCP server manager; start/stop and status display |
| Multimodal Vision | [`pi-multimodal-proxy`](https://www.npmjs.com/package/pi-multimodal-proxy) | partial | Image/audio proxy tool; reads ~/.pi/agent/multimodal-proxy.json |
| Nano Context | [`pi-nano-context`](https://www.npmjs.com/package/pi-nano-context) | none | TUI footer context indicator; desktop-side adapter only |
| Observational Memory | [`pi-observational-memory`](https://www.npmjs.com/package/pi-observational-memory) | headless | Observation memory (automatic, always-on); list and entry included |
| Powerline Footer | [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | none | Powerline footer status indicator; desktop-side adapter only |
| pi-rewind | [`pi-rewind`](https://www.npmjs.com/package/pi-rewind) | partial | Git checkpoints + `/rewind` restore dialogs (files/conversation); Tree/Fork restore prompts via Extension UI |
| Pi Search | [`pi-search`](https://www.npmjs.com/package/pi-search) | partial | pi-search web/docs/Context7 search toolkit |
| Sequential Thinking | `@feniix/pi-sequential-thinking` | headless | 结构化思考链工具（阶段/思考链卡片） |
| Simplify | [`pi-simplify`](https://www.npmjs.com/package/pi-simplify) | headless | Code precision review (success-tool pattern); list and entry included |
| Skills Manager | `@vanillagreen/pi-skills-manager` | headless | 技能发现与桌面启停（列出 Worker 已加载技能） |
| Studio | [`pi-studio`](https://www.npmjs.com/package/pi-studio) | partial | REPL and PDF/HTML export tool (screenshot + open file) |
| Subagents | [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | headless | Subagent delegation and routing (subagent tool cards: mode/runId/results) |
| Pi Sync | `@narumitw/pi-sync` | headless | 配置同步到 R2（配置 ~/.pi/agent/pi-sync.local.json） |
| Themes Bundle | `@firstpick/pi-themes-bundle` | none | pi 终端主题 bundle（桌面用独立 Appearance 设置） |
| Tool Display | [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) | headless | Tool display decorator (TUI only); desktop-side adapter only |
| TPS Extensions | `@kinarajv/pi-tps-extensions` | none | TUI 页脚/token 显示（桌面无对应组件） |
| Advisor | `@juicesharp/rpiv-advisor` | headless | 第二意见（由 advisor 工具触发） |
| Ask User Question | `@juicesharp/rpiv-ask-user-question` | native | 结构化问卷（桌面问卷对话框，含选项预览合并） |
| Trellis | [`trellis`](https://www.npmjs.com/package/trellis) | native | Trellis sub-agent manager; status read-only side panel + tool cards |

Authoring: [adapter-authoring-guide.md](../adapter-authoring-guide.md) · [doc/README.md](../README.md)
