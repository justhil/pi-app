# pi Desktop 扩展适配器编写指南（兼容层 v2）

> **读者**：人类开发者，或任意 AI 助手。  
> **目标**：为 **pi npm 扩展**（`@earendil-works/pi-coding-agent` 的 extension 包）编写 **`adapter.json`**，使 **pi Desktop**（Electron GUI）在不改扩展源码的前提下，提供配置页、时间线工具卡、弹窗交互、斜杠命令语义、右栏面板等桌面能力。  
> **原则**：扩展仍按 pi SDK 注册 tools/commands/TUI；桌面通过 **声明式 JSON + 通用原语** 桥接，**禁止**在桌面 App 里为单个插件写 `if (pluginId === '...')` 或专用 IPC channel。  
> **外置覆盖内置**：`~/.pi/desktop/adapters` 或项目 `.pi/desktop/adapters` 可按 **`match.names` 包名** 整份替换 App 内置适配器，详见 **§1**。

---

## 0. 一分钟心智模型

```
pi 扩展 (npm)                    pi Desktop App
─────────────────                ─────────────────────────────
registerTool / registerCommand   adapter.json 声明 match
ExtensionUIContext (TUI)    →    通用弹窗 Host（§8，全插件复用）
扩展自己的 config 文件      →    config.configFile + 通用表单
工具输出 / details          →    toolCard 模板渲染
/registerFoo 命令           →    slash 行为 (notify / config-page / …)
（可选）工作区数据          →    sidePanel.stateProvider（App 注册一次）
```

**适配器不是扩展的一部分**：它是桌面侧的「接线图」。可放在：

| 优先级 | 路径 |
|--------|------|
| 最高 | `<项目>/.pi/desktop/adapters/<name>.adapter.json` |
| 中 | `~/.pi/desktop/adapters/<name>.adapter.json` |
| 内置 | pi-desktop 仓库 `src/extension-compat/builtin/*.adapter.json` |

**加载与「外置覆盖内置」** 见 **§1**（按 `match.names` 包名整份替换，非按 `id` 深合并）。

---

## 1. 适配器加载与外部覆盖内置

pi Desktop 在启动与切换工作区时调用 `loadAdapterCatalog(projectDir)`，合并三层来源得到最终 catalog。扩展作者可在 **不等 App 发版** 的情况下，用外置 JSON **替换** 应用内置的同名扩展适配器（例如扩展 v2 新增 tool、改 config 路径、升级 `tier`）。

### 2.1 三层来源与优先级

| 顺序 | 来源 | 路径 | 说明 |
|------|------|------|------|
| 低 | **内置** | 随 pi-desktop 发布的 `src/extension-compat/builtin/*.adapter.json` | 默认全集，打包进 App |
| 中 | **用户外置** | `~/.pi/desktop/adapters/` | 本机所有项目生效 |
| 高 | **项目外置** | `<项目根>/.pi/desktop/adapters/` | 仅当前工作区生效，可提交到团队仓库 |

合并规则：**先载入内置列表 → 再应用用户目录中的每个文件 → 再应用项目目录中的每个文件**。后应用的层可以去掉前面层里「认领同一扩展包」的条目。

文件名任意，扩展名须为 `.adapter.json` 或 `.json`。

### 2.2 覆盖判定：扩展包名（`match.names`），不是 `id`

外置文件 **不会** 与内置做「同 `id` 字段级深合并」。覆盖单位是 **npm 扩展包**（与 probe 的 name / packageName 对齐）：

1. 从外置 adapter 收集 **包名键**：`match.names` 中的每一项 + 该文件的 `id`，经规范化（小写、去掉 `package:` 前缀）。
2. 从 catalog 中 **删除** 所有与此外置 adapter **包名冲突** 的既有条目（内置或其它外置均可被删）。
3. 将 **此外置 JSON 整份** 追加进 catalog。

包名是否「同一个扩展」与 `resolveV2ByPluginName` 使用 **同一套模糊规则**：键相等、或互为后缀、或一方 `includes` 另一方。例如外置写 `"names": ["pi-search"]` 会替换内置 `match.names: ["pi-search"]` 的那条，即使你把外置 `id` 改成 `pi-search-v2` 也可以。

**因此：**

| 做法 | 结果 |
|------|------|
| 外置 `match.names` 含 `pi-search` | 替换内置里认领 `pi-search` 的 adapter，**整文件生效** |
| 仅外置 `id` 与内置相同，但 `names` 对不上 | **不会** 替换内置；catalog 里可能短暂存在两条（直到 names 冲突） |
| 外置与内置 `names` 都含 `@scope/pkg` | 替换成功；可只更新 tools / config / interact 等任意字段 |

### 2.3 整份替换的含义

外置文件是 **完整** `adapter.json`，不是 patch：

- 可修改 `tier`、`displayName`、`toolCard`、`interact`、`slash`、`sidePanel`、`config` 等 **任意顶层字段**。
- 可更换 `id`（设置页、IPC 的 `adapterId` 以外置为准；`match.names` 仍须让扩展被认领）。
- **不会** 自动把外置 `match.tools` 与内置列表做并集；外置未写的 tool 若只在被删掉的内置里有，则桌面不再为该 tool 提供该 adapter 的卡片（除非另一 adapter 的 `match.tools` 认领）。

### 2.4 用户外置 vs 项目外置

两层外置 **各自** 对当前列表执行「按包名剔除 + 追加」：

```
builtin[]
  → apply( ~/.pi/desktop/adapters/* )     // 用户层
  → apply( <project>/.pi/desktop/adapters/* )  // 项目层，最高
```

同一包若 **用户与项目各放一份**，以 **项目目录** 为准。同一目录内多个文件认领 **同一包名** 时，按目录读取顺序依次 `apply`（后读入的文件最终胜出）。

### 2.5 推荐：发布「适配器更新包」

扩展维护者可将新版 adapter 单独分发，例如：

`~/.pi/desktop/adapters/pi-search.adapter.json`

```json
{
  "$schema": "pi-desktop-adapter/v1",
  "id": "pi-search",
  "displayName": "Pi Search",
  "match": {
    "names": ["pi-search", "@earendil-works/pi-search"],
    "tools": ["search", "web_fetch", "my_new_tool"],
    "commands": ["/search", "/search-config"]
  },
  "tier": "partial",
  "config": { "configFile": "~/.config/pi-search/config.json", "sections": [] },
  "toolCard": { "template": "list", "icon": "Globe" },
  "slash": { "/search-config": "config-page" }
}
```

要点：`names` 必须包含用户机器上 probe 到的包名。改外置文件后：**切换工作区**、**打开设置页**（自动 `refresh` 缓存），或重启应用。详见 `adapter-layer-plan.md` **§2.1–§2.2**（性能与缓存刷新）。

### 2.6 如何确认当前生效的是哪一份

- IPC `adapters.json.catalog` → 响应里的 `sources[adapterId]` 为 `builtin` 或 `override`。
- 实现：`src/extension-compat/adapter-loader.ts`（`adapterPackageKeys`、`adaptersSharePackage`、`applyPackageOverrides`）。

### 2.7 常见误区

| 误区 | 说明 |
|------|------|
| 以为同 `id` 会深合并 | 已废弃；必须靠 `match.names` 包名覆盖 |
| 外置只写增量字段 | 无效；外置必须是完整 adapter 语义（未写字段即缺失） |
| 忘记写 `names` 只写 `tools` | 无法替换内置，扩展也可能对不上设置页 |
| 与内置 `tier: none` 想「启用」 | 外置可写 `partial`/`native` 并覆盖，但 `names` 须匹配已安装扩展 |

---

## 2. 最小可用 `adapter.json`

```json
{
  "$schema": "pi-desktop-adapter/v1",
  "id": "my-pi-extension",
  "displayName": "My Extension",
  "description": "一句话说明桌面支持范围",
  "match": {
    "names": ["my-pi-extension", "@scope/my-pi-extension"],
    "tools": ["my_tool"],
    "commands": ["/my-cmd"]
  },
  "tier": "partial"
}
```

- **`id`**：适配器唯一 ID，通常与包名或产品名一致。  
- **`match.names`**：必须与 probe 到的扩展 **name / packageName** 能对上（大小写不敏感，支持后缀匹配）。  
- **`tier`**：见 §3。  
- 仅写 `match` + `tier` 时：设置里可能显示「有扩展但桌面适配较弱」；建议补 `toolCard` / `config` / `slash`。

---

## 3. `tier`（兼容等级）

| tier | 设置页「桌面适配器」 | probe `compatibility` | 适用 |
|------|----------------------|------------------------|------|
| `native` | 显示，标高兼容 | `native` | 工具卡 + 交互 + 配置较完整 |
| `partial` | 显示 | `basic` | 部分能力（常见：仅配置 + 工具卡） |
| `headless` | 显示 | `headless` | 无 TUI 或桌面只展示工具/命令说明 |
| `none` | **不**作为桌面适配器 | `blocked` + TUI-only | 纯 TUI 主题/页脚等，桌面用自有设置 |

---

## 4. 顶层字段总览

| 字段 | 类型 | 说明 |
|------|------|------|
| `$schema` | string | 可选，建议 `pi-desktop-adapter/v1` |
| `id` | string | **必填** |
| `displayName` | string | 设置页展示名 |
| `description` | string | 设置页 / slash 提示文案 |
| `match` | object | **必填**，见 §7 |
| `tier` | string | **必填**，见 §3 |
| `config` | object | 配置页，见 §7 |
| `toolCard` | object | 时间线工具卡，见 §7 |
| `interact` | object | 弹窗字段映射（问卷/审图），见 **§8** |
| `slash` | object | 斜杠桌面语义，见 §10 |
| `sidePanel` | object | 右栏 Tab，见 §10 |

---

## 5. `match` — 认领扩展

```json
"match": {
  "names": ["pi-search", "@org/pi-search"],
  "tools": ["search", "web_fetch"],
  "commands": ["/search", "/search-config"]
}
```

| 子字段 | 作用 |
|--------|------|
| `names` | 绑定已安装扩展（package 名、文件夹名） |
| `tools` | 每个 tool 名可映射到 **一个** adapter 的 `toolCard`（先匹配到的 adapter 为准） |
| `commands` | 认领斜杠命令；若 `slash` 里无该项，桌面默认行为为 **`notify`** |

**工具与适配器**：`findAdapterByTool(toolName)` 在 catalog 中查找 `match.tools` 包含该名的 adapter。

---

## 6. 原语 A：`config` — 设置里的配置页

桌面通过 **`adapter.config.get` / `adapter.config.set`** 读写，逻辑在 `adapter-backend.ts`。

### 6.1 配置存储模式（四选一或组合）

| 模式 | 声明 | 行为 |
|------|------|------|
| **共享文件** | `configFile` + `fileKeyMap` | 读写扩展同款 JSON（如 `~/.config/foo/config.json`），原子写 + `.bak` |
| **环境变量覆盖** | `envOverride` | 读时：env 优先于文件；表单仍用逻辑 key |
| **桌面本地** | 无 `configFile`，或 `localKeys` | 仅存 electron-store（按 workspace + adapterId） |
| **pi 全局 settings** | `piSettingsKey` | 读写 `~/.pi/agent/settings.json` 的单个顶层 key |

**`localKeys`**：列在其中的字段 **不** 写入 `configFile`，只进 App 本地（适合「时间线内联预览」等桌面开关）。

**`secret` 字段**：展示掩码；`set` 时空字符串或含 `•`/`…` 表示「未改密钥」，不会覆盖文件。

### 6.2 表单字段 `ConfigField`

| `type` | UI | 备注 |
|--------|-----|------|
| `text` | 单行输入 | |
| `secret` | 密码框 + `keySet` 派生 | 见 `derived` |
| `select` | 下拉 | `options` 静态，或 `optionsFrom` 动态 |
| `number` | 数字 | |
| `boolean` | 开关 | |

**`optionsFrom`（动态下拉）**：

```json
{
  "key": "model",
  "type": "select",
  "optionsFrom": {
    "url": "${searchApiUrl}/models",
    "headers": { "Authorization": "Bearer ${searchApiKey}" },
    "itemsPath": "data",
    "valueFrom": "id",
    "timeoutMs": 15000
  }
}
```

模板语法：`${fieldKey}`，支持简单三元 `${apiKeySet?on:off}`（在 `derived` / action URL 中）。

### 6.3 `derived` — 状态格（只读）

```json
"derived": [
  { "label": "main_search", "available": "${searchApiKeySet}", "detail": "openai:${searchApiKeySet?on:off}" }
]
```

### 6.4 `actions` — 配置页按钮

| `type` | 行为 |
|--------|------|
| `httpCheck` | 用 **未掩码** 配置发 HTTP，展示状态行 |
| `openPath` | `url` 模板解析为路径（由 UI 打开） |
| `reload` | 占位刷新 |

```json
{
  "id": "test",
  "type": "httpCheck",
  "label": "连通性",
  "method": "GET",
  "url": "${baseUrl}/v1/models",
  "headers": { "Authorization": "Bearer ${apiKey}" },
  "timeoutMs": 15000,
  "report": { "countPath": "data.length", "label": "模型数" }
}
```

### 6.5 `customRenderer` — 非静态表单（少数）

若配置无法用语义 `sections` 表达，在 adapter 中写：

```json
"config": { "customRenderer": "mcp-diagnostics" }
```

键必须在 App 的 `custom-config-renderers.ts` 注册（如 `skills-manager`、`mcp-diagnostics`）。**新插件应优先用 sections + configFile，避免新增 customRenderer。**

### 6.6 配置示例（共享文件 + env）

见内置：`src/extension-compat/builtin/pi-search.adapter.json`、`pi-image-gen.adapter.json`。

### 6.7 配置示例（pi settings 单 key）

见内置：`pi-fff.adapter.json`（`piSettingsKey: "fff-mode"`）。

---

## 7. 原语 B：`toolCard` — 时间线工具卡

扩展执行 tool 时，桌面根据 **`match.tools`** 选中 adapter，再按 `toolCard` 渲染。

### 7.1 模板 `template`

| 值 | 适用场景 | 渲染要点 |
|----|----------|----------|
| `default` | 通用文本 / 原生类工具 | 高亮文本；`read/edit/bash` 等走 A 层原生预览 |
| `list` | 搜索、文档、多信源 | 运行中 `statusField` 状态行 + metadata 条 + 输出正文 |
| `media` | 生图、审图、多模态 | 从 output/details 收集图片路径/URL，内联预览 |
| `tree` | subagent、trellis_subagent | `details.results[]` / 单 agent 形态 |
| `kv` | 结构化问答结果 | `questions` 列表展示 |

可省略 `template` → 等同 `default`。

### 7.2 `icon`

**lucide-react** 图标名（PascalCase 字符串），如 `"Globe"`、`"Image"`、`"Network"`。用于时间线工具行图标。

### 7.3 `statusField`

工具 **update** 阶段摘要，JSONPath，例如：

```json
"statusField": "$.output.text"
```

也支持从字符串 output 解析 JSON。未设置时用通用首行截断。

### 7.4 `fields` — 从 args/details/output 抽字段

路径前缀约定：

| 前缀 | 数据源 |
|------|--------|
| `$.args.xxx` | tool 调用参数 |
| `$.details.xxx` | tool result details |
| `$.output.xxx` | tool 输出（可 JSON 解析） |
| `$.xxx` | 依次尝试 args / details / output |

示例（问卷卡）：

```json
"toolCard": { "template": "kv", "icon": "MessageCircleQuestion" }
```

配合 `interact` 从 args 取 `questions`（见 §8）。

### 7.5 多工具同一扩展

在 `match.tools` 列出多个工具名；若卡片的 template 相同，共用一个 `toolCard` 定义。若不同工具需要不同模板，需要 **两个 adapter id** 或未来扩展为 per-tool 映射（当前实现为 **每个 adapter 一个 toolCard**，多 tool 共享）。

---

## 8. 原语 C：扩展弹窗（全插件复用）

桌面为 **所有** pi 扩展提供同一套 **Extension UI** 管线，无需每个插件写 React/Electron。扩展在 Worker 内照常使用 pi SDK **`ExtensionUIContext`**（`ctx.ui.*`）；桌面用 **`ExtensionUIHost`** + **`desktop-ui-bridge`** 把 TUI 交互换成 GUI。

```
扩展 tool
  → ctx.ui.select | confirm | input | custom | notify
  → Worker desktop-ui-bridge（pending Promise）
  → ipc:extension-ui-request → Renderer ExtensionUIHost
  → 用户操作 → ipc:extension.respondUI → Worker 恢复 Promise
```

### 8.1 无需 `interact` 也能弹窗

| 扩展 API | 桌面 UI | 阻塞 Worker |
|----------|---------|-------------|
| `ctx.ui.select(title, options)` | 选项列表对话框 | 是 |
| `ctx.ui.confirm(title, message)` | 是 / 否 / 取消 | 是 |
| `ctx.ui.input(title, placeholder?)` | 单行输入 | 是 |
| `ctx.ui.notify(msg, type?)` | Toast（Sonner） | **否** |
| `ctx.ui.custom` → ask 问卷 | `QuestionnaireDialog` | 是 |
| `ctx.ui.custom` → image_review | `ImageReviewDialog` | 是 |

未写 `interact` 时上述 API **仍可用**；建议在 `match.tools` 中列出 tool，并配置 **`toolCard`** 以便时间线展示。

### 8.2 `interact` — 声明式字段映射（推荐）

Worker 在 **`tool_execution_start`** 调用 `resolveInteractByTool(toolName)`，按 adapter 声明从 **tool args** 提取字段（不写插件名分支）。

```json
"interact": {
  "trigger": { "tool": "ask_user_question" },
  "schema": "questions",
  "fields": {
    "questions": "$.questions",
    "options": "$.options"
  }
}
```

| `schema` | 桌面 UI | 典型 tool |
|----------|---------|-----------|
| `questions` | 多题问卷（可选 preview 侧栏） | `ask_user_question` |
| `review` | 审图 + 选项 + 反馈 | `image_review` |
| `clarify` | 预留（当前走问卷 fallback） | — |

**`fields`**：JSONPath 相对 **args 根**，用 `$.questions`（不要写 `$.args.questions`）。**`trigger.tool`** 须与 `registerTool` 的 name 一致。

**审图**（`builtin/pi-image-gen.adapter.json`）：

```json
"interact": {
  "trigger": { "tool": "image_review" },
  "schema": "review",
  "fields": {
    "image": "$.image",
    "title": "$.title",
    "question": "$.question",
    "context": "$.context",
    "options": "$.options",
    "allow_feedback": "$.allow_feedback"
  }
}
```

**问卷**（`builtin/rpiv-ask-user-question.adapter.json`）：

```json
"toolCard": { "template": "kv", "icon": "MessageCircleQuestion" },
"interact": {
  "trigger": { "tool": "ask_user_question" },
  "schema": "questions",
  "fields": { "questions": "$.questions" }
}
```

### 8.3 挂起、继续作答、发送与切会话（统一行为）

**所有**阻塞弹窗共享，**适配器 JSON 无需配置**：

| 操作 | 效果 |
|------|------|
| 遮罩 / 右上角 X / Esc / **稍后作答** | **挂起**：关弹窗，**不** `respondUI`，Worker 继续等待 |
| 时间线工具行 **继续作答** | 重新打开同一弹窗 |
| **弹窗打开时** | 不能发新消息 |
| **挂起后**（弹窗已关） | 可发消息；可切 session（除非 agent `running`） |
| **取消并通知扩展** | `respondUI({ cancelled: true })`，扩展 Promise 结束 |
| 提交 / 选择 / 确认 | `respondUI` 带 `result` / `value` / `confirmed` |

挂起时时间线对应 tool 行会标 **继续作答**（`extensionUiSuspended`）。切工作区/会话会 `resetForSessionContext()` 清空挂起状态。

### 8.4 `extension.respondUI` 契约

| 场景 | payload 要点 |
|------|----------------|
| 问卷提交 | `{ id, result: { cancelled: false, answers } }` |
| 问卷/用户取消 | `{ id, cancelled: true }` 或 `result.cancelled: true` |
| 审图 | `{ id, result: { choice, label, feedback? } }` |
| select | `{ id, value }` |
| confirm | `{ id, confirmed: boolean }` |
| input | `{ id, value }` |
| 仅挂起 | **不发** respondUI，直至继续作答后提交或显式取消 |

### 8.5 新增弹窗形态（仅 pi-desktop 维护者）

一种 UI = 一种 `schema` / Host 分支 + 可选 `InteractDef` 字面量；**禁止**按 `pluginId` 分支。扩展作者不能单靠 JSON 发明全新控件（同 `customRenderer`）。

### 8.6 弹窗自检

- [ ] `match.tools` 含会弹 UI 的 tool  
- [ ] `toolCard`：问卷 `kv`，审图 `media`  
- [ ] 复杂参数配 `interact` + `fields`  
- [ ] 实测：挂起 → 继续作答 → 提交；取消并通知扩展  

---

---

## 9. 原语 D：`slash` — 斜杠命令桌面语义

Composer 输入 `/foo` 时：

1. 若属 **A 层** App builtin（`/model`、`/review`、`/tree`…）→ 本地处理，**不**走 adapter。  
2. 否则 **`slash.resolve`** 查 adapter catalog。

| 行为 | 桌面效果 |
|------|----------|
| `config-page` | 打开 **设置 → 扩展/适配器** 对应配置子页 |
| `open-panel` | 切换右栏 `panelId`（见 `sidePanel`） |
| `notify` | Toast 展示 `description`（或 meta），并 **`prompt.send`** 把整行斜杠发给 pi |
| `execute` | 仅 **`prompt.send`**（无 toast） |
| （无匹配） | `passthrough`，当普通消息发送 |

```json
"slash": {
  "/search-config": "config-page",
  "/search": "notify",
  "/trellis": "open-panel"
}
```

`match.commands` 中列出但未写 `slash` 的命令 → 默认 **`notify`**。

---

## 10. 原语 E：`sidePanel` — 右栏 Tab + 设置开关

声明后 **自动**：

- 出现在 **设置 → 右侧栏** 列表（适配器来源会标「适配器」）  
- 出现在主界面右栏 Tab（受用户开关控制）  
- 可被 `slash` → `open-panel` 打开  

### 10.1 已注册原语（键名在 JSON 里填写，App 无插件名分支）

| `stateProvider` | `panelComponent` | 能力 | 典型 JSON 用法 |
|-----------------|------------------|------|----------------|
| `workspace-trellis` | `workspace-tasks` | 读项目根 `.trellis/`（tasks、prd、journal、`task.py current`），任务列表 + 日志 UI | Trellis 扩展 `builtin/trellis.adapter.json` |
| （自定义，需 PR 注册） | `generic-json` | 任意 `getState` 返回 JSON，只读树 | 新扩展调试 / 简单状态 |

**核心右栏**（Review / Run / Context / Intercom / Tree）由 App 固定，**不**在 adapter 里声明。任务类右栏一律走 **适配器栏目**（`source: adapter`），`panelId` 建议 `adapter:{id}`。

### 10.2 示例（Trellis 扩展 — 仅 JSON，无 App 内 `if (trellis)`）

```json
"sidePanel": {
  "stateProvider": "workspace-trellis",
  "panelComponent": "workspace-tasks",
  "panelId": "adapter:trellis",
  "label": "Trellis",
  "description": "任务与阶段（只读）",
  "icon": "ListTree",
  "defaultEnabled": true
},
"slash": { "/trellis": "open-panel" }
```

`open-panel` 时桌面用 `slash.resolve` 返回的 **`panelId`**（上例为 `adapter:trellis`）切换右栏；**无**默认面板 id。

### 10.3 字段说明

| 字段 | 说明 |
|------|------|
| `stateProvider` | **必填**。Main `side-panel-registry.ts` 已注册的原语名（如 `workspace-trellis`） |
| `panelComponent` | **必填**。Renderer `side-panel-host` 已注册的原语名（如 `workspace-tasks`、`generic-json`） |
| `panelId` | Tab / `rightPanelPrefs` 键；省略则为 `adapter:{id}` |
| `label` / `description` / `icon` | 设置与 Tab 文案；icon 为 lucide 名 |
| `defaultEnabled` | 新用户默认是否勾选该 Tab |

### 10.4 数据流

1. Renderer：`adapter.sidePanel.getState { adapterId, workspaceId }`（**必须**传 `adapterId`，无兜底）  
2. Main：`workspaceId` 优先作为读盘 `cwd`；`findAdapterById` → `sidePanel.stateProvider` → 返回 `state`  
3. `workspace-tasks` 面板期望 `state.ready === true`（无布局时 `ready: false`）；兼容旧字段 `hasTrellis`  
4. 面板标题用目录项 `fallbackLabel`（来自 adapter `sidePanel.label`）

### 10.5 新扩展如何接右栏

| 目标 | 做法 |
|------|------|
| 与 Trellis 同级任务面板 | JSON 使用 `workspace-trellis` + `workspace-tasks`（读同一 `.trellis/` 布局） |
| 只展示自定义状态 | PR 注册新 `stateProvider` + 可选新 `panelComponent`，或先用 `generic-json` |
| 禁止 | 在 `src/main/ipc.ts` 增加 `ipc:myPlugin.getState`；在 Host 写 `if (adapterId==='…')` |

**prefs 迁移**：旧版核心栏 id `trellis` 已移除；`normalizeRightPanelPrefs` 会把旧 `trellis` 开关同步到 `adapter:trellis`。

---

## 11. 通用 IPC（扩展作者只需知道契约）

Renderer 使用 `ipcClient.invoke('<method>', req)`，内部 channel 为 `ipc:<method>`。

| method | 请求 | 响应要点 |
|--------|------|----------|
| `adapter.config.get` | `{ adapterId, workspaceId? }` | `{ view }` 掩码后表单 |
| `adapter.config.set` | `{ adapterId, workspaceId?, patch }` | `{ view }` |
| `adapter.action.run` | `{ adapterId, actionId }` | `{ ok, lines?, error? }` |
| `adapter.field.options` | `{ adapterId, fieldKey }` | 动态 select 选项 |
| `adapters.json.catalog` | — | `{ adapters, errors, sources }` |
| `adapters.catalog` | — | probe 与 adapter 合并（设置页列表） |
| `slash.resolve` | `{ command }` | `{ behavior, meta: { matchNames, desktopSupport, panelId, adapterId } }` |
| `adapter.sidePanel.getState` | `{ adapterId, workspaceId? }` | `{ ok, state }` 或 `{ ok: false, error }` |
| `rightPanels.catalog` | — | `{ catalog, adapterPanels, prefs, defaultPrefs }` |

扩展 **运行时** 不直接调这些 IPC；由 **pi Desktop UI** 调用。适配器 JSON 决定 UI 如何展示扩展行为。

---

## 12. 完整示例集

### 12.1 仅 headless + 说明（无配置）

```json
{
  "id": "pi-intercom",
  "displayName": "Intercom",
  "description": "跨会话协调；桌面只读说明与默认工具卡",
  "match": {
    "names": ["pi-intercom"],
    "tools": ["intercom", "contact_supervisor"],
    "commands": ["/intercom"]
  },
  "tier": "headless",
  "toolCard": { "template": "default", "icon": "MessagesSquare" },
  "config": { "note": "Broker 由扩展自管；桌面不提供可编辑项。" },
  "slash": { "/intercom": "notify" }
}
```

### 12.2 搜索类（configFile + list 卡 + 多 tool）

参考：`builtin/pi-search.adapter.json`（节选结构）

```json
{
  "id": "pi-search",
  "match": {
    "names": ["pi-search"],
    "tools": ["search", "web_fetch", "docs_search"],
    "commands": ["/search", "/search-config"]
  },
  "tier": "partial",
  "config": {
    "configFile": "~/.config/pi-search/config.json",
    "fileKeyMap": { "searchApiKey": "apiKey" },
    "envOverride": { "searchApiKey": "SEARCH_API_KEY" },
    "sections": [{ "title": "API", "fields": [{ "key": "searchApiKey", "type": "secret", "label": "API Key" }] }],
    "actions": [{ "id": "test", "type": "httpCheck", "url": "${searchApiUrl}/models", "method": "GET" }]
  },
  "toolCard": { "template": "list", "icon": "Globe", "statusField": "$.output.text" },
  "slash": { "/search-config": "config-page", "/search": "notify" }
}
```

### 12.3 生图 + 审图交互

参考：`builtin/pi-image-gen.adapter.json`（`config` + `interact` + `media` + `slash`）。

### 12.4 结构化问卷

参考：`builtin/rpiv-ask-user-question.adapter.json`（`interact` + `kv`）。

### 12.5 Trellis（右栏 + tree 卡 + open-panel）

参考：`builtin/trellis.adapter.json`（`sidePanel`: `workspace-trellis` + `workspace-tasks`，`panelId`: `adapter:trellis`）。

### 12.6 纯 TUI（桌面不适配）

```json
{
  "id": "amp-themes",
  "match": { "names": ["amp-themes"] },
  "tier": "none",
  "config": { "note": "主题由 TUI/扩展自管；桌面使用 Appearance 设置。" }
}
```

---

## 13. 为「新 pi 扩展」编写适配器的步骤（给 AI 的执行清单）

1. **收集事实**  
   - npm 包名、`registerTool` 名称、`registerCommand` 名称  
   - 扩展配置文件路径与 JSON 形状  
   - 是否使用 `ExtensionUIContext` / 何种 tool 会弹 UI  
   - 是否需在时间线特殊展示  

2. **创建** `my-ext.adapter.json`，填 `id`、`match.names`、`tier`。  

3. **配置**  
   - 与扩展共享文件 → `configFile` + `fileKeyMap` + `sections`  
   - 仅桌面开关 → `localKeys`  
   - 与 pi CLI 共享 flag → `piSettingsKey`  

4. **每个 tool** 在 `match.tools` 中列出，并设置合适 `toolCard.template` + `icon`。  

5. **弹窗 tool** 增加 `interact`（`trigger.tool` + `schema` + `fields`）。  

6. **斜杠** 写 `slash`；打开配置用 `config-page`，打开右栏用 `open-panel` + `sidePanel`。  

7. **右栏**（可选）  
   - 声明 `sidePanel`  
   - 若需定制数据：在 pi-desktop 提 PR 注册 `stateProvider`  
   - 仅展示 JSON：用 `generic-json`  

8. **放置文件**（见 **§1**）  
   - 上游合并：放进 `builtin/`  
   - 覆盖内置发新版：`~/.pi/desktop/adapters/` 或 `.pi/desktop/adapters/`（`match.names` 对齐包名）  
   - 项目级覆盖优先于用户级  

9. **验证**  
   - 设置 → Extensions：扩展被认领、`tier` 正确  
   - 设置 → 适配器/配置：表单读写正确  
   - 对话中触发 tool：工具卡、弹窗正确  
   - 弹窗：挂起 → 时间线「继续作答」→ 提交；取消并通知扩展（§8.3）  
   - 输入斜杠：行为符合 `slash`  

---

## 14. 禁止事项（架构红线）

| 禁止 | 应做 |
|------|------|
| 在桌面 `src/main/ipc.ts` 加 `ipc:myPlugin.*` | 用 `adapter.*` 通用 channel |
| 在 Renderer 写 `if (toolName === 'my_tool')` | 用 `toolCard` 模板 + `fields` |
| 复制扩展业务逻辑到桌面 | 只声明展示与配置桥接 |
| 未 `match.names` 就指望设置页出现 | 对齐 package 名 |
| `tier: none` 却写完整 config 指望显示适配器 | `none` = 不做 B 层适配 |

---

## 15. 与 pi 扩展源码的关系

- 扩展 **不需要** `import` pi-desktop。  
- 扩展 **不需要** 知道 `adapter.json` 存在。  
- 适配器只描述「桌面如何解释」扩展已注册的能力。  
- 扩展仍应把配置写在文档约定的路径，以便 `configFile` 与扩展 TUI/CLI **共用同一文件**。

---

## 16. 参考实现路径（pi-desktop 仓库）

| 主题 | 文件 |
|------|------|
| Schema 类型 | `src/extension-compat/adapter-schema.ts` |
| 加载 / 外置按包名覆盖 | `src/extension-compat/adapter-loader.ts`（`applyPackageOverrides`） |
| 配置读写 | `src/extension-compat/adapter-backend.ts` |
| JSONPath / 状态行 | `src/extension-compat/json-path.ts` |
| 右栏目录合并 | `src/extension-compat/side-panel-catalog.ts`、`packages/shared/right-panels.ts` |
| 右栏状态原语 | `src/main/side-panel-registry.ts`、`src/main/workspace-task-panel-reader.ts` |
| 右栏 UI 原语 | `src/renderer/src/features/side-panels/workspace-tasks-side-panel.tsx`、`side-panel-host.tsx` |
| UI 桥 / 弹窗 | `src/worker/desktop-ui-bridge.ts`、`src/renderer/src/features/extension-ui/*`、`extension-ui-store.ts` |
| 配置表单 | `src/renderer/src/features/extension-ui/adapter-config-panel.tsx` |
| 工具卡 | `src/renderer/src/features/timeline/tool-card-*.tsx` |
| 内置样例 | `src/extension-compat/builtin/*.adapter.json` |
| 架构短文 | `doc/adapter-layer-plan.md` |

---

## 17. 复制即用空白模板

```json
{
  "$schema": "pi-desktop-adapter/v1",
  "id": "REPLACE_ADAPTER_ID",
  "displayName": "REPLACE_DISPLAY_NAME",
  "description": "REPLACE_ONE_LINE_DESCRIPTION",
  "match": {
    "names": ["REPLACE_PACKAGE_NAME"],
    "tools": ["REPLACE_TOOL_1"],
    "commands": ["/REPLACE_CMD"]
  },
  "tier": "partial",
  "config": {
    "note": "可选：说明配置落盘位置",
    "sections": []
  },
  "toolCard": {
    "template": "default",
    "icon": "Box"
  },
  "slash": {
    "/REPLACE_CMD": "notify"
  }
}
```

按上表逐块替换并删除不需要的节（如无 config 则删 `config`，无弹窗则勿写 `interact`）。  
**右栏（任务布局）** 可追加：

```json
"sidePanel": {
  "stateProvider": "workspace-trellis",
  "panelComponent": "workspace-tasks",
  "panelId": "adapter:REPLACE_ADAPTER_ID",
  "label": "任务",
  "icon": "ListTree",
  "defaultEnabled": true
}
```

---

*文档版本：与 pi-desktop 兼容层 v2 实现同步；若 schema 新增字段，以 `adapter-schema.ts` 为准。*