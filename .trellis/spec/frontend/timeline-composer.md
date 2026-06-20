# Timeline 与 Composer 规范

> 对话区、工具展示、输入框的**已落地模式**与**禁止回退**项。改 `features/timeline/*`、`features/composer/*` 前必读。

---

## 1. Timeline 信息架构

### 1.1 宽度与排版

- 容器：包在 **`chat-content-column`** 内（**比例限宽 + clamp**，见 `product-intent-and-shell.md`）；Timeline 仅 `py-4`，水平 padding 由 column 承担
- 正文：**15px / line-height 1.7**（参考桌面客户端 对齐）；用户气泡 **max-w-[80%]**，背景 `var(--message-user-bg)`，圆角 **`8px 0 8px 8px`**
- 助手消息：**无左侧 Bot 头像**；Markdown 渲染必选（`MarkdownView` + `remark-gfm`）

### 1.2 助手流式输出

- 用 **`streamingAssistantId` + 函数式 append**，禁止用陈旧闭包对最后一条 assistant 重复 append（曾导致**逐字重复三遍**）
- `Worker` `message_end` 带完整文本；`ui-store.processEvent` 用 **`getState()`** 避免丢事件
- 视觉：`ThinkingIndicator` / `StreamingCaret`；空闲 **800ms** 可显示「思考中…」（`useStalledHint`）；**Hooks 必须在任何 early return 之前调用**

### 1.3 工具行：默认小、可展开

| 层级 | 行为 |
|------|------|
| **折叠行** | 约 **12px**、次要色 `foreground-secondary`；优先 **`buildToolSummary(toolArgs)`**（参考桌面客户端 param summary）；**不要**大块 Card 占屏 |
| **连续工具** | **`buildTimelineDisplayItems`**：相邻 ≥2 个 `tool-call` → **`ToolGroupSummary`**（「N 次工具 · read, edit…」）；单条仍 **`ToolCallRow`** |
| **展开体** | **`CollapsiblePanel`**（grid `0fr→1fr`），禁止仅 mount/unmount 无高度动画 |
| **插件工具卡** | **仅** `tool-card-templates.tsx` + `adapter.json` 的 `toolCard.template`；**禁止** `features/timeline` 里 `if (toolName===插件名)` |

### 1.4 原生工具预览

- 模块：`tool-previews.tsx`（edit/write diff、read 行号、grep/ffgrep/fffind、bash）
- **`TimelineItem.toolArgs`**：live 在 tool `start` 存 `event.input`；历史在 Worker **`getMessages`** 读 JSONL **`toolCall.arguments`**（不是 `input`），toolResult 按 **`toolCallId`** 合并到对应卡
- 改 `tool-card-templates.tsx` 后**必须**保留 `renderNativeToolPreview` 的 **import** 与 `DefaultTemplate` 内调用（曾漏 import 导致 `nativePreview is not defined`）

### 1.5 历史加载（上滑）

- **禁止**在 `requestAnimationFrame` 里改 `scrollTop` 再 prepend；用 **`useLayoutEffect`** 在 DOM 增高后恢复滚动
- 滚动列外包 **`min-h-0`**；`loadMoreHistory` 用 **in-flight 锁** + `scrollHeightBeforeLoadRef`；顶部 **~160px** 触发；提供 **可点击**「点击或继续上滑加载」
- 选历史会话：**先** `session.open` 绑定 Worker **再** `getMessages`；避免只看历史却在另一 live session 上对话

### 1.6 消息 hover（布局稳定）

- **禁止** hover 时用 `max-height` 把复制行「挤」进布局（快速移动鼠标会**抽动消息**）
- 模式：**固定 32px `message-actions-slot`**（参考桌面客户端 h-32px），仅 **opacity 280ms**；`MessageHoverShell` 用 **React `onMouseEnter/Leave`** 切 `message-actions-slot-visible`（比纯 CSS `group-hover` 更稳）
- 复制钮：`chrome-icon-btn`（hover 底 + active scale 0.92）
- **完整 hover/动效清单**：见 **`motion-and-interaction.md` §4.1、§5、§6**

---

## 2. Composer

### 2.1 外壳（参考桌面客户端 sendbox）

- `composer-shell` / `composer-shell-focused`：`rounded-2xl`、focus 时 `var(--focus-border)` + `var(--focus-shadow)`
- 停止：`animate-stop-breathe`（运行中发送钮变停止）
- 芯片：`composer-pill.tsx`（模型、思考）；Picker：`picker-backdrop`、`picker-panel`、`picker-row` 动画

### 2.2 斜杠命令

- 补全：Worker **`getCommands`**，名称带 **`/`** 前缀（`withSlash`）
- 参数补全：`commands.completions` + 二级 popover；**`composer.tsx` 必须 import `firstToken`**（缺则 slash 静默失败）
- 内置立即执行并清空输入；扩展命令先 **`slash.resolve`** 再按 behavior 路由

### 2.3 附件

- 拖拽：**全区域 overlay** + 上方 **file chips**（参考跨端客户端 思路）；发送时路径以 **`@`** 引用拼接
- 空内容且无附件时禁用发送

### 2.4 Run 面板边界

- **不得**把模型下拉、思考 cycle 放回 RunPanel（用户明确反对）

---

## 3. 色彩与 token（对话区）

- 多档背景：`--bg-base`、`--bg-1`…、`--message-user-bg`；品牌 **`--aou-*` / `--brand`**
- 工具行 chevron/名称可用 aou 色阶；**次要文案**用 `--text-secondary` / `foreground-secondary`，避免 `muted/40` 过淡

---

## 4. 改对话区时的检查清单

- [ ] 助手流式是否仍用 streamingAssistantId？
- [ ] 工具默认折叠 + 连续聚合是否保留？
- [ ] 插件渲染是否仍只走 adapter 模板？
- [ ] hover 复制是否固定占位？
- [ ] 上滑历史是否 useLayoutEffect？
- [ ] Markdown 是否仍渲染助手正文？