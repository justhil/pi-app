# Changelog

## [0.3.8] — 2026-06-24

### 修复

- **对话区会话分区**：左侧「对话」区域的每个临时对话现在绑定真实 `sessionId/sessionFile`，点击已有对话直接加载对应 JSONL 历史，不再误进入项目 Home / 新对话页
- **Sandbox 会话恢复**：`workspace.sandbox.list` 会为旧 sandbox 自动回填最近 session 绑定，兼容 0.3.7 已创建的临时对话
- **显式 session 打开**：`activateWorkspace(path, { sessionId, sessionFile })` 即使 `session.list` 暂时为空，也会优先打开传入的 session，避免历史会话被空列表短路成新对话入口
- **Worker session 生命周期**：新会话恢复持久化 `SessionManager.create(cwd)`，保证 `session.new` 能拿到可恢复的 JSONL 文件；加载历史 session 后标记为已有 prompt 状态，后续新建会话会正确切分

## [0.3.7] — 2026-06-24

### 输入区富文本重构

- **contenteditable 富文本编辑器**：原生 textarea 替换为 contenteditable div，支持文中内联附件 chip（不可编辑节点），保留附件在文本中的精确位置
- **跨平台粘贴/拖放文件**：Ctrl+V/Cmd+V 从文件管理器粘贴文件、拖放文件、+ 按钮选择文件，均解析真实磁盘路径并插入内联 chip 占位
- **文件类型图标**：chip 根据扩展名显示对应 lucide 图标（代码/压缩包/PDF/文档/表格/音视频等）
- **延迟 tooltip 系统**：悬浮 chip 420ms 后显示完整路径，portal 到 body + fixed 定位避免被 overflow 容器裁剪；编辑器清空/发送时 `hideAllDelayedTooltips()` 立即清除残留 tooltip

### 剪贴板图片

- **改用 TUI 方式**：粘贴截图写入临时文件 `pi-clipboard-{uuid}.{ext}`，以裸路径发送（与 TUI 一致），不再走 base64 `sendWithImages`，避免 Vision Proxy consent 弹窗与 400 错误
- 占位文本简化为 `[image file]`
- 时间线中图片 chip 可点击用系统默认程序打开

### 时间线

- **附件 chip 渲染**：用户消息按 segments 渲染内联附件 chip，保留发送时的附件位置
- **修复 @ 误渲染**：历史消息不再用 `parseInlineAttachments` 扫描 `@path`（会误将邮箱/@提及渲染为文件 chip），改为仅从 optimistic segments 渲染

### 冷启动修复

- **promptSent 标志**：Worker 新增 `promptSent` 布尔值，`newSession` 在 `promptSent===false` 时跳过 dispose+re-init，避免刚创建的 session 被误销毁导致 `session.prompt()` 挂起
- **SessionManager.inMemory()**：恢复使用 `inMemory()` 而非 `create(cwd)`，session 持久化由 `session.new` IPC 处理
- **Sandbox 启动守卫**：`model.set`/`thinkingLevel.set` IPC 在 Worker 未运行且 fallback cwd 为 sandbox 路径时抛错，不再自动为旧 sandbox 启动 Worker
- **启动工作区解析**：`resolveBootWorkspaceState` 将持久化的 sandbox 路径解析为 ephemeral draft，跳过 Worker 启动

### 其他

- **EditorCursorAdapter**：输入历史从 textarea 专用 API 重构为适配器接口，兼容 contenteditable
- **TimelineItem.segments**：新增 segments 字段用于位置保持的附件渲染
- **拖放覆盖层动画**：拖入文件时显示半透明覆盖层，松手添加
## [0.3.6] — 2026-06-23

### 时间线 / 原生工具

- **edit / write**：多源 diff（`details.patch`、输出 unified diff、`edits[]` / `old_string`·`new_string`），默认展开 edit 行级绿红对比
- **read / grep / bash**：统一从工具输出抽取文本，预览折叠与摘要行改进

### 兼容层（扩展适配）

- 内置适配器 **Hashline Edit**（`@jerryan/pi-hashline-edit`）：`adapter.json` 声明 `toolCard.template: hashline` + `protocol: hashline-v1`
- 新增 `extension-compat/renderer/`：`hashline` 模板原语（列对齐 `LINE#HASH│`、unified diff、`toolDetails.diff` 优先），时间线经 catalog 查表渲染，**不在 App 源码写插件名分支**
- `insert` 纳入原生工具行展开路径

### 文档

- README：内置适配器列表补充 Hashline Edit；说明适配器 JSON 与工具卡模板关系

## [0.3.5] — 2026-06-23

### 输入区

- **发送历史**：`↑` / `↓` 调回当前工作区+会话下已发送内容（空框、顶格光标或全文选中时生效）
- 进入历史前暂存当前草稿（失焦或第一次 `↑` 时写入，非逐字）；`↓` 回到最新可恢复草稿
- `Alt+↑` 仍为拉回排队消息

### 修复

- 设置保存「默认模型」后，输入区展示与 Worker 实际请求模型一致（`model.set` / 展示优先 `runtime.getState`）

### 文档

- README 补充发送历史、模型配置页、默认模型同步等操作说明

## [0.3.4] — 2026-06-23

### 修复

- 设置「Pi → 默认模型」下拉误用 `model.list`（Worker 鉴权可用列表），切换项目后 Worker 重启导致只剩当前默认一项
- 默认模型下拉改为 `model.list` 的 `scope=catalog`，直接展开 `~/.pi/agent/models.json` 全部条目，与项目无关；切换工作区 / 回到窗口时刷新列表

## [0.3.3] — 2026-06-23

### 修复

- 重启后已恢复工作区目录但 Worker 未启动：设置提示需重开工作区、切换模型无效，需先对话一次才恢复
- 启动时自动 `ensureWorker`；同路径再进工作区、打开会话时绑定 Worker；`model.set` / Pi 设置在无 Worker 时按 `currentProject` 拉起

## [0.3.2] — 2026-06-23

### 模型配置

- 设置「模型」页文案精简，去掉冗余说明与外部项目引用

## [0.3.1] — 2026-06-23

### 公式渲染

- 对话与 Markdown 预览支持 **KaTeX**：`\( \)`、`\[ \]`、`$$ $$`、围栏 ` ```math ` / ` ```latex `
- 加载 **mhchem** 化学式（`\ce{}` 等）；常用数学宏 `\RR`、`\dd` 等
- 流式输出时自动闭合未写完的数学定界符；块级公式卡片样式与横向滚动
- 非流式可选单美元行内 `$...$`（流式开启以降低误解析）

### 模型配置

- 设置新增 **「模型」** 页：管理 `~/.pi/agent/models.json`
- 供应商列表可展开；**预设**（OpenAI、Anthropic、Gemini、Ollama 等）一键添加
- **拉取远端模型目录**，点击 **+** 加入本地；单模型可配置 name / reasoning / contextWindow 等
- IPC：`pi.models.get` / `set` / `fetch`；保存后 Worker `reloadModels`

### 其他

- 内置 SDK 手动升级/切换（与 0.3.0 进行中改动一并纳入本版）