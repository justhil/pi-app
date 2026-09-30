# 兼容层 v2：adapter.json 与桌面原语

> **给扩展作者 / 任意 AI 的完整编写说明**：见 **[adapter-authoring-guide.md](./adapter-authoring-guide.md)**（组件清单、IPC、多示例、模板）。  
> 与 `dev/architecture.md`、`.trellis/spec/backend/quality-guidelines.md` 并列。  
> **目标**：App 本体（`src/` 除 `src/extension-compat/`）**零插件名分支**；新扩展优先 **只加 JSON**（及可选用户覆盖），不改 Renderer/Main 业务代码。

---

## 1. 分层（A / B / C）

| 层 | 含义 | 桌面表现 |
|----|------|----------|
| **A** | pi 内核：builtin / skill / prompt / 原生 settings 写回 | Composer 斜杠、`/model`、`SessionManager` 等专用 IPC（**不是** adapter） |
| **B** | Pi 扩展及独立只读贡献 | `adapter.json` + 通用 `adapter.*` IPC + 原语 UI；不新增插件运行时 |
| **C** | 纯 TUI 装饰 | `tier: "none"` → 设置里标 TUI-only，不显示「桌面适配器」 |

---

## 2. adapter.json 位置与合并

优先级（高覆盖低）：

1. `<project>/.pi/desktop/adapters/*.json`
2. `~/.pi/desktop/adapters/*.json`
3. `src/extension-compat/builtin/*.adapter.json`（随应用发布）

**外置覆盖内置**：按扩展 **包名**（`match.names` + `id` 规范化）判定是否为同一插件；命中则 **整份删除** 内置/低优先级条目并 **追加外置 JSON**（**不是** 同 `id` 深合并）。用户层、项目层依次 `applyPackageOverrides`；项目目录优先于用户目录。

详细说明与示例见 **[adapter-authoring-guide.md](./adapter-authoring-guide.md) §1**。

加载入口：`await prepareAdapterCatalog(cwd)`。`loadAdapterCatalog(cwd)`、`findAdapterById`、`findAdapterByTool` 等同步函数只查询已准备的快照，不读盘。`adapters.json.catalog` 返回 `revision`、`scope`、`sources` 和错误。包名规范化后精确匹配，别名必须写在 `match.names`；同层冲突报告错误，不按名称片段猜测。旧声明未写 `schemaVersion` 时按 1 处理。

### 2.1 性能与内存缓存

| 层级 | 行为 |
|------|------|
| **内置** `builtin/*.adapter.json` | 构建时 `import` 进 Main/Worker 包，**运行时不再读盘、不再 JSON.parse** |
| **外置** 用户目录 + 项目 `.pi/desktop/adapters/` | `prepareAdapterCatalog` 异步读取；单个声明最多 256KB，坏文件隔离 |
| **进程内缓存** | 按运行环境目录与项目缓存，同一作用范围的并发请求合并；1 秒内直接返回对象，其后检查文件大小和修改时间，未变不重读内容 |
| **换项目** | 使用独立快照，不清空其他项目；Renderer 拒绝失效环境的迟到响应 |

热路径查询（`findAdapterByTool`、`resolveV2Slash` 等）只查内存。插件安装信息由预览进程通过 Pi 资源解析补充；源码扫描是受限的补充提示，不决定插件是否允许运行。Worker 已运行时，插件工具、命令和加载错误以实际结果为准。

### 2.2 何时刷新缓存（`invalidateAdapterCatalog`）

修改 **外置** `~/.pi/desktop/adapters` 或 **项目** `.pi/desktop/adapters` 后，需让桌面重新读盘：

| 触发 | 说明 |
|------|------|
| **打开设置页** | Renderer 进入设置时调用 `adapters.json.catalog { refresh: true }`，并 `invalidateRightPanelCatalog()`（右栏目录依赖 adapter `sidePanel`） |
| **切换工作区** | 切换到该项目的独立快照 |
| **手动** | IPC `adapters.json.catalog` / `adapters.catalog` 传 **`refresh: true`** |
| **运行中修改** | 可见窗口每 5 秒及重新获得焦点时检查当前目录；版本变化广播 `adapter-catalog-changed`，更新设置、工具卡和右栏。Worker 正在执行时推迟到安全点应用 |

内置 adapter 随 App 发版更新；外置覆盖无需发版。刷新声明不重载 Pi 插件、不新建 Worker；配置中的显式 `reload` 动作才重载请求项目的空闲 Worker，忙碌时返回 `SESSION_BUSY`。

---

## 3. Schema 要点

见 `src/extension-compat/adapter-schema.ts`。

| 字段 | 用途 |
|------|------|
| `schemaVersion` / `kind` | 版本 1；`plugin` 默认适配插件，`desktop` 为不绑定插件的只读面板 |
| `match.names` | 精确扩展包名 / 显式别名 |
| `match.tools` | 工具卡模板、probe 兼容 |
| `match.commands` | 斜杠认领（无 `slash` 条目时默认 `notify`） |
| `tier` | `native` / `partial` / `headless` / `none` |
| `config` | 配置页：sections、configFile、envOverride、actions、customRenderer |
| `toolCard` | `template` + `icon` + `statusField` + `fields` |
| `interact` | 弹窗字段映射 → 全插件复用 ExtensionUIHost（挂起/继续作答见 authoring-guide §7.3） |
| `slash` | `notify` / `config-page` / `execute` / **`open-panel`** |
| `sidePanel` | `source` 或 `stateProvider` 二选一，加 `panelComponent` 与可选 `panelId` |

---

## 4. 原语（Renderer）

### 4.1 配置页

- `adapter.config.get` / `adapter.config.set`（Main → `adapter-backend.ts`）
- 通用表单：`adapter-config-panel.tsx`
- 特例注册表：`custom-config-renderers.ts`（键来自 `config.customRenderer`，如 `skills-manager`、`mcp-diagnostics`）

### 4.2 工具卡

- 查表：`tool-card-registry.ts`（`adapters.json.catalog`）
- 模板：`tool-card-templates.tsx`（default / list / media / tree / kv）
- 状态行：`ui-store` 用 `toolCard.statusField` + `json-path.ts`
- 字段映射：`toolCard.fields` → `applyToolCardFields`

### 4.3 交互 UI

- Worker：`tool_execution_start` → `resolveInteractByTool` → `desktop-ui-bridge`
- Renderer：`extension-ui-host.tsx`（问卷、image_review 等）

### 4.4 斜杠（B 层）

1. A 层 builtin： `slash-exec.ts`（`/model`、`/review`、`/tree`…）
2. 扩展：`slash.resolve` → Composer  
   - `config-page` → 打开扩展配置子页  
   - `open-panel` → `setActivePanel(panelId)`  
   - `notify` → toast + `prompt.send`  
   - `execute` → 仅 `prompt.send`  
   - `passthrough` → 当普通消息发送

### 4.5 右栏 Tab（适配器可「注册」栏目）

在 `adapter.json` 声明 `sidePanel` 后：

1. **设置 → 右侧栏** 自动多一行开关（与核心 Review/Run 等并列；`source: adapter` 会标「适配器」）
2. **主界面右栏 Tab** 自动出现（受 prefs 控制）
3. **`slash` → `open-panel`** 可 `setActivePanel(panelId)`

**已注册右栏原语**（扩展作者在 JSON 里填键名即可）：

| stateProvider | panelComponent | 说明 |
|---------------|----------------|------|
| `workspace-trellis` | `workspace-tasks` | `.trellis/` 任务 + 日志只读面板（原 Trellis 能力） |
| `source: { type: "json", path: "tasks.json" }` | `list` / `tree` / `generic-json` | 当前项目内 JSON，只读，不启动 Worker |

示例（Trellis 扩展）：

```json
"sidePanel": {
  "stateProvider": "workspace-trellis",
  "panelComponent": "workspace-tasks",
  "panelId": "adapter:trellis",
  "label": "Trellis",
  "description": "任务与阶段（只读）",
  "icon": "ListTree",
  "defaultEnabled": true
}
```

- `panelId` 省略时默认为 `adapter:{id}`；**不再有**核心栏 `trellis`，任务面板均为适配器来源
- Main：`side-panel-registry.ts` + `workspace-task-panel-reader.ts`；禁止每插件专用 IPC
- Renderer：`SidePanelHost` 按 `adapterId` + `panelComponent` 查表，无插件名 if
- 目录：`ipc:rightPanels.catalog` = 核心（review/run/…）+ 所有声明 `sidePanel` 的 adapter

---

## 5. IPC 清单（B 层通用）

| Channel | 说明 |
|---------|------|
| `adapter.config.get` / `set` | 配置视图读写 |
| `adapter.action.run` | httpCheck / openPath / reload |
| `adapter.field.options` | select 动态选项 |
| `adapters.json.catalog` | 纯 JSON 目录；可选 `{ refresh: true }` 清空缓存后加载 |
| `adapters.catalog` | probe + json 合并列表（设置页）；可选 `{ refresh: true }` |
| `slash.resolve` | 斜杠桌面语义 |
| `adapter.sidePanel.getState` | 右栏面板状态 |

---

## 6. 新增扩展 checklist

1. 在 `builtin/` 增加 `my-ext.adapter.json`（或在用户目录覆盖）。
2. `match.names` 与 `settings.packages` 包名一致。
3. 为每个需在时间线展示的 tool 设置 `toolCard.template`。
4. 需弹窗的工具加 `interact`。
5. 斜杠加 `slash`；打开右栏用 `open-panel` + `sidePanel`。
6. 配置写共享文件则声明 `configFile` + `fileKeyMap`。
7. `tier: none` 仅用于纯 TUI 主题/页脚等。
8. **不要**在 `src/renderer` / `src/main`（除 registry）添加 `if (id === 'my-ext')`。

审计：`node scripts/audit-adapters.mjs`；设置页 Extensions 列表对照 probe 结果。

---

## 7. Trellis 扩展（纯 JSON 接线示例）

- `builtin/trellis.adapter.json`：`toolCard.tree`、`sidePanel` 使用 **`workspace-trellis` + `workspace-tasks`**、`panelId: adapter:trellis`、`slash: { "/trellis": "open-panel" }`
- 无 `TrellisPanel` / `trellis-reader` / `ipc:trellis.*`；UI 为通用 `WorkspaceTasksSidePanel`，数据 `adapter.sidePanel.getState { adapterId: "trellis", workspaceId }`

---

## 8. 相关文件

```text
src/extension-compat/adapter-schema.ts
src/extension-compat/adapter-loader.ts
src/extension-compat/adapter-backend.ts
src/extension-compat/json-path.ts
src/extension-compat/plugin-adapters.ts
src/main/side-panel-registry.ts
src/main/workspace-task-panel-reader.ts
src/renderer/src/features/side-panels/
src/worker/desktop-ui-bridge.ts
src/renderer/src/features/extension-ui/
src/renderer/src/features/timeline/tool-card-*
```