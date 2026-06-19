# pi Desktop TUI 替代与全插件适配

> 状态：planning  | 优先级：P1 | 指派：justhil
> 权威设计：`docs/tui-replacement-and-adapters.md`（A/B/C 分层，硬约束）

## 目标

把 pi Desktop 从「聊天壳」升级为 **pi 的新壳**：TUI 里属于 pi 本体的能力在 App UI 里 1:1 复刻（A 层）；**只有扩展**走适配器（B 层）；纯 TUI 装饰不复刻（C 层）。同时支持当前本地已安装的全部 27 个 pi 插件。

## 三层边界（不可偏移）

| 层 | 归属 | 写回 |
|----|------|------|
| A | pi/TUI 原生（内置`/`、`/skill:`、`/prompt:`、原生 settings、模型/thinking） | settings.json |
| B | 扩展（工具、扩展`/`、配置页）→ 适配器 | app-local |
| C | 纯 TUI 装饰 | 不复刻 |

## 子任务（21 个，5 阶段）

### Phase 1：A 层命令系统
- **A1** 命令系统重构 — Worker `get_commands` 权威源，废弃 Main 扫目录
- **A2** Composer 斜杠联想 UI — popover、模糊过滤、category 分色
- **A3** A 层命令执行语义 — builtin 走 IPC，`/skill:`/`/prompt:` 展开再发

### Phase 2：A 层设置 + 模型 UI
- **A4** Pi 原生设置页与 settings 写回 — 经 Worker SettingsManager，覆盖旧约束
- **A5** 模型与 thinking 切换 UI — Run 面板下拉 + `/model` 命令

### Phase 3：B 层适配器框架
- **B1** 适配器 meta 扩展 — `configPageCommands`、`slashBehavior` 字段
- **B2** 扩展斜杠执行分流 — notify vs config-page
- **B3** 扩展配置 Host 接口与 app-local 存储
- **B4** 扩展配置页 Schema Form 渲染
- **B5** 工具卡片 native 渲染增强

### Phase 4：插件适配（按适配器分组，覆盖 27 插件）
- **P1** ask 适配器 — `@juicesharp/rpiv-ask-user-question`（native，已有 UI 桥，补 preview/Submit）
- **P2** trellis 适配器 — `trellis`（native，只读面板+配置页）
- **P3** image 适配器 — `pi-multimodal-proxy`、`pi-image-gen`（partial）
- **P4** doc 适配器 — `pi-markdown-preview`（partial）
- **P5** repl 适配器 — `pi-studio`（partial）
- **P6** intercom 适配器 — `pi-intercom`（headless）
- **P7** subagent 适配器 — `pi-subagents`（headless）
- **P8** 启停类插件批量登记 — `pi-rewind`/`pi-btw`/`pi-simplify`/`pi-cache-optimizer`/`pi-continue`/`pi-goal`/`@ff-labs/pi-fff`/`@vanillagreen/pi-skills-manager`/`@agnishc/edb-context-viewer`/`pi-agentsmd`/`@narumitw/pi-sync`/`pi-mcp-adapter`/`@juicesharp/rpiv-advisor`/`pi-observational-memory`/`pi-tool-display`
- **P9** C 层纯 TUI 装饰标注 — `pi-nano-context`/`pi-powerline-footer`/`amp-themes`/`@kinarajv/pi-tps-extensions`

### Phase 5：收尾
- **F1** 集成测试与插件清单核对
- **F2** 文档与规范同步

## 依赖关系

```
A1 → A2 → A3 → (A5)
A4 → A5
B1 → B2 → (P1-P7 斜杠分流)
B3 → B4 → (P1-P7 配置页)
全部 → F1 → F2
```

## 验收标准

1. Composer 输入 `/` 弹出联想，包含 builtin/prompt/skill/extension 四类。
2. `/model`、`/think`、`/skill:`、`/prompt:` 可执行，行为与 TUI 一致。
3. Pi 配置页改动写回 `~/.pi/agent/settings.json`（全局）或 `.pi/settings.json`（项目）。
4. 扩展斜杠按 meta 分流：启停类→Toast，进配置页类→适配器配置页。
5. 扩展配置存 app-local，不写 pi settings。
6. 27 个本地插件全部被探测、正确分类（native/partial/headless/none）。
7. 未登记扩展不显示「桌面适配器：包名」。
8. `tier: none` 的 C 层插件标注「仅终端生效」。

## 范围外

- 远程 registry 实际签名校验实现（接口预留即可）
- 新插件市场
- C 层 TUI 装饰的实际复刻
