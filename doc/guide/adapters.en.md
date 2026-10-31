<!-- AUTO-GENERATED — do not edit by hand -->

# Built-in extension adapters

**[简体中文](./adapters.zh-CN.md)**

Generated from `src/extension-compat/builtin/*.adapter.json` (43 adapters).

1. Install in terminal pi: `pi install npm:<name>` or `pi install git:...`
2. Enable in `~/.pi/agent/settings.json` → `packages`
3. Restart the desktop **worker session**

| Adapter | Package | Tier | Description |
|---------|---------|------|-------------|
| Aegis | [`Aegis`](https://www.npmjs.com/package/Aegis) | headless | Aegis workflow extensions (reuses the generic and Trellis cards) |
| Amp Themes | [`amp-themes`](https://www.npmjs.com/package/amp-themes) | none | Amp theme loader/editor package; desktop-side adapter only |
| Context Viewer | `@agnishc/edb-context-viewer` | partial | /context opens the desktop Context panel (the extension's terminal overlay can't show on desktop) |
| Magic Context | `@cortexkit/pi-magic-context` | partial | Cross-session memory and context management: ctx_* tool cards, todowrite list above the composer |
| ACE Tool | [`pi-ace-tool`](https://www.npmjs.com/package/pi-ace-tool) | headless | ACE tool capability manager; writes ~/.pi/agent/ace-tool.json + connectivity test |
| Agents.md | [`pi-agentsmd`](https://www.npmjs.com/package/pi-agentsmd) | headless | AGENTS.md generator; list and entry included |
| Background Terminal | `@bytetrue/pi-background-terminal` | partial | Background shell commands: background_run / status / kill tool cards with automatic exit notifications |
| BTW | [`pi-btw`](https://www.npmjs.com/package/pi-btw) | headless | By-the-way insert model; list and status included |
| Cache Optimizer | [`pi-cache-optimizer`](https://www.npmjs.com/package/pi-cache-optimizer) | headless | Better prompt cache hit rates: feature switches in ~/.pi/agent/pi-cache-optimizer-config.json |
| Continue | [`pi-continue`](https://www.npmjs.com/package/pi-continue) | headless | Mid-task continue; reads ~/.pi/agent/extensions/pi-continue.json |
| Curated Themes | `@victor-software-house/pi-curated-themes` | none | pi terminal themes (the desktop app uses its own Appearance settings) |
| PiDeck Todo | [`pi-deck-todo`](https://www.npmjs.com/package/pi-deck-todo) | partial | Show the current session Todo list above the composer |
| Devin Search | [`pi-devin-search`](https://www.npmjs.com/package/pi-devin-search) | headless | Devin / Windsurf web search: devin_search tool cards, settings in ~/.pi/agent/devin-search.json |
| Fast Context | [`pi-fast-context`](https://www.npmjs.com/package/pi-fast-context) | headless | Semantic context search; writes ~/.pi/agent/fast-context.json + connectivity test |
| FFF | `@ff-labs/pi-fff` | headless | Fuzzy path search mode (reads and writes the fff-mode flag in ~/.pi/agent/settings.json) |
| Goal | [`pi-goal-x`](https://www.npmjs.com/package/pi-goal-x) | partial | Goal planning and autonomous runs: the task list sits above the composer; settings in ~/.pi/agent/pi-goal-x-settings.json |
| Goal | `@astrosheep/pi-goal-next` | partial | Persistent autonomous goals: get_goal / create_goal / update_goal tool cards and /goal command |
| Hashline Edit | `@jerryan/pi-hashline-edit` | partial | Hash-anchor read/edit/insert/grep; temporary file dedicated hashline preview |
| Image Gen | [`pi-image-gen`](https://www.npmjs.com/package/pi-image-gen) | partial | Image generation and editing (~/.pi/agent/image-gen.json, connectivity test, model picker) |
| Markdown Preview | [`pi-markdown-preview`](https://www.npmjs.com/package/pi-markdown-preview) | partial | Markdown/LaTeX preview and PDF/HTML export tool (screenshot + open file) |
| MCP Adapter | [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) | headless | MCP server manager; start/stop and status display |
| Multimodal Vision | [`pi-multimodal-proxy`](https://www.npmjs.com/package/pi-multimodal-proxy) | partial | Image/audio proxy tool; reads ~/.pi/agent/multimodal-proxy.json |
| Nano Context | [`pi-nano-context`](https://www.npmjs.com/package/pi-nano-context) | none | TUI context bar under the editor (the desktop shows context in the Run panel) |
| Observational Memory | [`pi-observational-memory`](https://www.npmjs.com/package/pi-observational-memory) | headless | Observation memory (automatic, always-on); list and entry included |
| Powerline Footer | [`pi-powerline-footer`](https://www.npmjs.com/package/pi-powerline-footer) | none | Powerline footer status indicator; desktop-side adapter only |
| Prompt Enhancer | `@jmcombs/pi-prompt-enhancer` | partial | Codebase-aware prompt rewriter using project tree, git context, and referenced files |
| Quality Gate | [`pi-quality`](https://www.npmjs.com/package/pi-quality) | partial | Completion gate, post-edit diagnostics, and /review clean-context code review (~/.pi/agent/pi-quality.json) |
| Rewind Hook | [`pi-rewind-hook`](https://www.npmjs.com/package/pi-rewind-hook) | partial | Automatic git checkpoints with file and conversation restore (settings in ~/.pi/agent/settings.json) |
| pi-rewind | [`pi-rewind`](https://www.npmjs.com/package/pi-rewind) | partial | Git checkpoints + /rewind: desktop dialogs for restore mode (files / conversation / both). Tree/Fork may prompt to restore files. TUI footer decoration is not replicated. |
| Pi Search | [`pi-search`](https://www.npmjs.com/package/pi-search) | partial | AI search, docs lookup and page fetching (reads and writes ~/.config/pi-search/config.json) |
| Sequential Thinking | `@feniix/pi-sequential-thinking` | headless | Structured thinking tool (stage and chain-of-thought cards) |
| Simplify | [`pi-simplify`](https://www.npmjs.com/package/pi-simplify) | headless | Code precision review (success-tool pattern); list and entry included |
| Skills Manager | `@vanillagreen/pi-skills-manager` | headless | Skill discovery and desktop on/off (lists the skills the worker loaded) |
| Studio | [`pi-studio`](https://www.npmjs.com/package/pi-studio) | partial | REPL and PDF/HTML export tool (screenshot + open file) |
| Subagents | [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | partial | Subagent delegation: subagent tool cards follow child sessions; settings in ~/.pi/agent/extensions/subagent/config.json |
| Pi Sync | `@narumitw/pi-sync` | headless | Sync config to R2 (configured in ~/.pi/agent/pi-sync.local.json) |
| Themes Bundle | `@firstpick/pi-themes-bundle` | none | pi terminal theme bundle (the desktop app uses its own Appearance settings) |
| Tool Display | [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) | headless | Tool display decorator (TUI only); desktop-side adapter only |
| TPS Extensions | `@kinarajv/pi-tps-extensions` | none | TUI footer and token display (no desktop counterpart) |
| Windows Notify | [`pi-win-notify`](https://www.npmjs.com/package/pi-win-notify) | none | CLI completion notification popup (duplicates built-in desktop notifications) |
| Advisor | `@juicesharp/rpiv-advisor` | partial | Second opinion: advisor tool cards; settings in ~/.config/rpiv-advisor/advisor.json |
| Ask User Question | `@juicesharp/rpiv-ask-user-question` | native | Structured questionnaire (desktop question dialog with option previews) |
| Trellis | [`trellis`](https://www.npmjs.com/package/trellis) | native | Trellis sub-agent manager; status read-only side panel + tool cards |

Authoring: [adapter-authoring-guide.md](../adapter-authoring-guide.md) · [doc/README.md](../README.md)
