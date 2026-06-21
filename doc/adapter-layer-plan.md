# 兼容层 v2：adapter.json 与桌面原语

> **给扩展作者 / 任意 AI 的完整编写说明**：见 **[adapter-authoring-guide.md](./adapter-authoring-guide.md)**（组件清单、IPC、多示例、模板）。  
> 与 `docs/architecture.md`、`.trellis/spec/backend/quality-guidelines.md` 并列。  
> **目标**：App 本体（`src/` 除 `src/extension-compat/`）**零插件名分支**；新扩展优先 **只加 JSON**（及可选用户覆盖），不改 Renderer/Main 业务代码。

---

## 1. 分层（A / B / C）

| 层 | 含义 | 桌面表现 |
|----|------|----------|
| **A** | pi 内核：builtin / skill / prompt / 原生 settings 写回 | Composer 斜杠、`/model`、`SessionManager` 等专用 IPC（**不是** adapter） |
| **B** | npm 扩展 | `adapter.json` + 通用 `adapter.*` IPC + 原语 UI |
| **C** | 纯 TUI 装饰 | `tier: "none"` → 设置里标 TUI-only，不显示「桌面适配器」 |

---

## 2. adapter.json 位置与合并

优先级（高覆盖低）：

1. `<project>/.pi/desktop/adapters/*.json`
2. `~/.pi/desktop/adapters/*.json`
3. `src/extension-compat/builtin/*.adapter.json`（随应用发布）

**外置覆盖内置**：按扩展 **包名**（`match.names` + `id` 规范化）判定是否为同一插件；命中则 **整份删除** 内置/低优先级条目并 **追加外置 JSON**（**不是** 同 `id` 深合并）。用户层、项目层依次 `applyPackageOverrides`；项目目录优先于用户目录。

详细说明与示例见 **`docs/adapter-authoring-guide.md` §1**。

加载 API：`loadAdapterCatalog(cwd)`、`invalidateAdapterCatalog()`、`findAdapterById`、`findAdapterByTool`、`resolveV2ByPluginName`、`resolveV2Slash`、`resolveInteractByTool`。`adapters.json.catalog` 的 `sources[id]` 可区分 `builtin` / `override`。

---

## 3. Schema 要点

见 `src/extension-compat/adapter-schema.ts`。

| 字段 | 用途 |
|------|------|
| `match.names` | 扩展包名 / 文件夹名 |
| `match.tools` | 工具卡模板、probe 兼容 |
| `match.commands` | 斜杠认领（无 `slash` 条目时默认 `notify`） |
| `tier` | `native` / `partial` / `headless` / `none` |
| `config` | 配置页：sections、configFile、envOverride、actions、customRenderer |
| `toolCard` | `template` + `icon` + `statusField` + `fields` |
| `interact` | 弹窗字段映射 → 全插件复用 ExtensionUIHost（挂起/继续作答见 authoring-guide §7.3） |
| `slash` | `notify` / `config-page` / `execute` / **`open-panel`** |
| `sidePanel` | `stateProvider` + `panelId`（右栏只读面板） |

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

必填字段示例：

```json
"sidePanel": {
  "stateProvider": "trellis",
  "panelComponent": "trellis",
  "panelId": "trellis",
  "label": "Trellis",
  "description": "…",
  "icon": "ListTree",
  "defaultEnabled": true
}
```

- `panelId` 省略时默认为 `adapter:{id}`（**新栏目**，不与核心 id 冲突即可）
- `panelComponent`: 已注册 UI 键（`trellis`）或 **`generic-json`**（通用 JSON 只读视图 + `adapter.sidePanel.getState`）
- 状态：`main/side-panel-registry.ts` 注册 `stateProvider`（禁止每插件一条 IPC）
- 目录合并：`ipc:rightPanels.catalog` = 核心 + 所有带 `sidePanel` 的 adapter

---

## 5. IPC 清单（B 层通用）

| Channel | 说明 |
|---------|------|
| `adapter.config.get` / `set` | 配置视图读写 |
| `adapter.action.run` | httpCheck / openPath / reload |
| `adapter.field.options` | select 动态选项 |
| `adapters.json.catalog` | 纯 JSON 目录 |
| `adapters.catalog` | probe + json 合并列表（设置页） |
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

## 7. 与 Trellis 的约定（示例）

- `trellis.adapter.json`：`toolCard.tree`、`sidePanel.stateProvider: trellis`、`slash["/trellis"]: open-panel`
- 面板 UI 仍为 `TrellisPanel`，数据走 `adapter.sidePanel.getState { adapterId: 'trellis' }`

---

## 8. 相关文件

```text
src/extension-compat/adapter-schema.ts
src/extension-compat/adapter-loader.ts
src/extension-compat/adapter-backend.ts
src/extension-compat/json-path.ts
src/extension-compat/plugin-adapters.ts
src/main/side-panel-registry.ts
src/worker/desktop-ui-bridge.ts
src/renderer/src/features/extension-ui/
src/renderer/src/features/timeline/tool-card-*
```