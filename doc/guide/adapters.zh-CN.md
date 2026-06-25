<!-- AUTO-GENERATED — do not edit by hand -->

# 内置扩展适配器

**[English](./adapters.en.md)**

由 `src/extension-compat/builtin/*.adapter.json` 自动生成（34 个）。

1. 终端安装：`pi install npm:<包名>` 或 `pi install git:...`
2. 在 `~/.pi/agent/settings.json` → `packages` 启用
3. 桌面端 **重启 Worker 会话**

| 适配器 | 扩展包 | Tier | 说明 |
|--------|--------|------|------|
| Aegis | [`Aegis`](https://www.npmjs.com/package/Aegis) | headless | Aegis 工作流扩展集（复用通用与 trellis 卡） |
| Amp Themes | [`amp-themes`](https://www.npmjs.com/package/amp-themes) | none | Amp 风格主题/编辑器装饰（桌面无对应组件） |
| Context Viewer | `@agnishc/edb-context-viewer` | headless | 上下文查看器（斜杠输出只读说明） |
| ACE Tool | [`pi-ace-tool`](https://www.npmjs.com/package/pi-ace-tool) | headless | ACE 代码智能工具（配置 ~/.pi/agent/ace-tool.json + 连通性测试） |
| Agents.md | [`pi-agentsmd`](https://www.npmjs.com/package/pi-agentsmd) | headless | AGENTS.md 生成（无斜杠入口） |
| BTW | [`pi-btw`](https://www.npmjs.com/package/pi-btw) | headless | 并行侧聊（斜杠状态输出） |
| Cache Optimizer | [`pi-cache-optimizer`](https://www.npmjs.com/package/pi-cache-optimizer) | headless | 缓存优化（运行时开关，影响新会话启动） |
| Continue | [`pi-continue`](https://www.npmjs.com/package/pi-continue) | headless | 中途续跑（配置 ~/.pi/agent/extensions/pi-continue.json） |
| Curated Themes | `@victor-software-house/pi-curated-themes` | none | pi 终端主题包（桌面用独立 Appearance 设置） |
| Fast Context | [`pi-fast-context`](https://www.npmjs.com/package/pi-fast-context) | headless | 语义代码搜索（配置 ~/.pi/agent/fast-context.json + 连通性测试） |
| FFF | `@ff-labs/pi-fff` | headless | 模糊路径搜索模式（读写 ~/.pi/agent/settings.json 的 fff-mode flag） |
| Goal | [`pi-goal`](https://www.npmjs.com/package/pi-goal) | headless | 目标循环（斜杠状态输出） |
| Hashline Edit | `@jerryan/pi-hashline-edit` | partial | 哈希锚定 read/edit/insert/grep；时间线专用 hashline 预览 |
| Image Gen | [`pi-image-gen`](https://www.npmjs.com/package/pi-image-gen) | partial | 生图与审图工具（配置 ~/.pi/agent/image-gen.json + 连通性测试 + 模型下拉） |
| Markdown Preview | [`pi-markdown-preview`](https://www.npmjs.com/package/pi-markdown-preview) | partial | Markdown/LaTeX 预览与 PDF/HTML 导出（工具结果 + 打开产物） |
| MCP Adapter | [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | headless | MCP 服务器适配器（连接诊断只读） |
| Multimodal Vision | [`pi-multimodal-proxy`](https://www.npmjs.com/package/pi-multimodal-proxy) | partial | 图像/视频分析代理（配置 ~/.pi/agent/multimodal-proxy.json） |
| Nano Context | [`pi-nano-context`](https://www.npmjs.com/package/pi-nano-context) | none | TUI 上下文进度条（桌面无对应组件） |
| Observational Memory | [`pi-observational-memory`](https://www.npmjs.com/package/pi-observational-memory) | headless | 观察记忆（自动生效，无斜杠入口） |
| Powerline Footer | [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | none | Powerline 页脚状态栏（桌面无对应组件） |
| pi-rewind | [`pi-rewind`](https://www.npmjs.com/package/pi-rewind) | none | Rewind session checkpoints |
| Pi Search | [`pi-search`](https://www.npmjs.com/package/pi-search) | partial | pi-search 网络/文档/Context7 搜索工具集 |
| Sequential Thinking | `@feniix/pi-sequential-thinking` | headless | 结构化思考链工具（阶段/思考链卡片） |
| Simplify | [`pi-simplify`](https://www.npmjs.com/package/pi-simplify) | headless | 代码精简审查（由工具触发，无斜杠入口） |
| Skills Manager | `@vanillagreen/pi-skills-manager` | headless | 技能发现与桌面启停（列出 Worker 已加载技能） |
| Studio | [`pi-studio`](https://www.npmjs.com/package/pi-studio) | partial | REPL 与 PDF/HTML 导出工具（结果卡片 + 打开产物） |
| Subagents | [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | headless | 子代理委派与链路（subagent 工具卡片解析 mode/runId/results） |
| Pi Sync | `@narumitw/pi-sync` | headless | 配置同步到 R2（配置 ~/.pi/agent/pi-sync.local.json） |
| Themes Bundle | `@firstpick/pi-themes-bundle` | none | pi 终端主题 bundle（桌面用独立 Appearance 设置） |
| Tool Display | [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) | headless | 工具显示紧凑化（TUI 专用，桌面无等价） |
| TPS Extensions | `@kinarajv/pi-tps-extensions` | none | TUI 页脚/token 显示（桌面无对应组件） |
| Advisor | `@juicesharp/rpiv-advisor` | headless | 第二意见（由 advisor 工具触发） |
| Ask User Question | `@juicesharp/rpiv-ask-user-question` | native | 结构化问卷（桌面问卷对话框，含选项预览合并） |
| Trellis | [`trellis`](https://www.npmjs.com/package/trellis) | native | Trellis 子代理进度与任务状态（只读面板 + 工具卡片） |

编写适配器：[adapter-authoring-guide.md](../adapter-authoring-guide.md) · [doc/README.zh-CN.md](../README.zh-CN.md)
