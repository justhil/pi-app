# Changelog

各版本条目维护于本文件。GitHub [Releases](https://github.com/justhil/pi-app/releases) 正文链接至对应 tag 下的本文件（见 [doc/RELEASE.md](doc/RELEASE.md)）。

## [0.4.10] — 2026-07-01

### 性能与稳定性

- 优化桌面端整体运行效率，减轻长时间会话下的界面与后台负载
- 提升应用启动、切换会话与消息流式展示时的稳定性
- 改进错误恢复与关键异常时的提示体验，减少无响应或静默失败

### 安全

- 加强本地凭据与语音相关配置的保护方式
- 默认采用更严格的渲染进程安全策略（调试可按文档临时关闭）

### 质量保障

- 扩充自动化检测与发布前检查，覆盖更多桌面环境
- 更新贡献与质量说明，便于后续版本维护

### 修复

- 设置侧栏「语音」导航文案显示异常
- 时间线与文件树「加载更多」条数显示异常

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.10/CHANGELOG.md)

## [0.4.9] — 2026-07-01

### 新增

- **文件预览多标签**：默认单文件替换预览；`Ctrl`/`⌘`+左键或右键「在新窗口打开」追加标签；左键切换、中键关闭、拖放排序；标签栏滚轮横滑与细滚动条（悬停显示）；标签右键复制路径
- **源码预览（VS Code 风格）**：JSON/TS/代码等行号槽 + Shiki；过大可「展开全部」并单次读全文件；Markdown 仍 Markdown 渲染；预览区铺满、无圆角卡片
- **展开预览到聊天区**：顶栏按钮将预览扩至主对话列宽度（再点收起）；内栏文件树不随展开自动收起
- **预览滚动**：与主对话相同的 Overlay 滚动条（纵/横可拖）
- **布局分隔线**：聊天列与右栏、预览与文件树接缝在常态与「展开预览」下均可见
- **预览刷新**：打开文件时每 2s 静默重载活动标签；磁盘删除或移走显示「文件已删除」

## [0.4.8] — 2026-07-01

### 新增

- **右栏「文件」Tab**：工作区只读文件管理（设置中可开关、排序）— 左侧预览、右侧文件树，顶栏显示当前路径并可收起内栏文件树
- **文件预览**：图片、Markdown、代码（Shiki）、HTML（sandbox）、纯文本；过大或二进制提示并在系统中打开
- **文件树**：懒加载目录、按名称搜索、大目录分页与条数上限（防卡顿）、文件夹/文件右键菜单（预览、附加到聊天、复制路径、重命名、在文件夹中显示）
- **拖放**：仅文件可拖入 Composer 附加聊天（`application/x-pi-file-path`）
- **IPC**：`workspace.fs.listDir` / `readText` / `rename`，路径沙箱限制在工作区根内
- **右栏宽度**：可拖至更宽（上限 720px），便于并排预览

## [0.4.7] — 2026-06-27

### 修复

- **首启无响应**：`pi.settings.get` 不再隐式 `workerManager.start`；无 Worker 时读 `~/.pi/agent/settings.json`；启动链减负（延后 catalog / session.list）

### 移除

- 设置中的启动诊断日志开关与「诊断」栏目（`startup.log` 相关 IPC 与模块）

## [0.4.6] — 2026-06-27

### 首启与诊断

- **默认新对话**：无持久化项目时启动进入临时「新对话」，Composer 可直接输入（首条发送再落盘）
- **启动诊断日志**：默认写入 `userData/logs/startup.log`（每次进程启动重置）；设置 → 常规可关闭；设置 → 诊断可查看/打开 logs 文件夹
- **启动链埋点**：Main / Renderer / Worker（init 超时、fatal 等）便于反馈「安装后无反应」类问题

## [0.4.5] — 2026-06-26

### Composer & Sessions

- **斜杠联想（预览态）**：`commands-catalog` 磁盘扫描 + adapter `slash`/`match.commands` + 扩展 probe（含 `pi.registerCommand`），无需等 session bind 全量列表
- **运行中可切会话**：后台 Worker 继续；预览其它会话且后台仍在跑时禁发；已停止可在预览会话发首条
- **切回 / 停止**：`workerLiveSnapshot` 与 `runtime.getState` 同步；单次 `prompt.abort` + 冷却，避免连点 clearQueue+abort
- **adapter `config-page` / `open-panel`**：发送前 `slash.resolve` 路由（如 `/fast-context-config`），不进 prompt，避免「Agent 启动中」卡死
- **斜杠 ok/error** 时清除乐观启动态

### 其它

- 删除 `expandConcatenatedSlashLine`（斜杠参数与 TUI 一致，须空格分参）

## [0.4.4] — 2026-06-26

### Composer & Timeline

- **Slash 发送对齐 TUI**：扩展斜杠整行走 `prompt.send`，去掉桌面侧 `slash.resolve` 分流；内建命令仍在本地执行
- **斜杠联想**：session 就绪后刷新命令表；菜单 Portal + 固定高度列表，滚轮与主对话区自绘滚动条一致，不再被主列裁切
- **排队 / 中止**：运行中 steer/followUp 与 TUI 一致；中止 `clearQueue` + `agent.abort()`，不发送 `/goal pause`
- **流式跟滚**：时间线流式输出时贴近底部自动跟随
- **思维链文案**：生成中 Thinking / 折叠后 Thought（i18n）
- **工具与扩展 UI**：交互工具 loading 同步；扩展 UI 阻塞时避免整页假死
- **斜杠发送**：与 TUI 一致，仅 `/cmd args`（空格分参）；`/goalxxx` 无空格时按普通用户消息交给模型

## [0.4.3] — 2026-06-25

### 文档

- **双语 README 精修**：面向用户重写，中英结构对齐；新增 Extensions（适配器/包生态兼容）与 Voice input（codex-asr 友链与设置说明）章节；图床截图
- **doc/ 目录整理**：用户指南 `doc/guide/`（中英）、适配器列表自动生成 `npm run docs:adapters`、适配器编写文档双语 `doc/README.md` / `doc/README.zh-CN.md`
- 源码注释中 `docs/` 路径引用修正为 `doc/`

### i18n

- 修复 `common` / `context` 命名空间中英双语遗漏与错误文案


## [0.3.12] — 2026-06-24

### 侧栏与会话

- **主栏 Reload**：主对话区右侧增加刷新按钮，同步侧栏列表与当前会话时间线（对齐 CLI 外部改动）
- **会话重命名**：显示名写入 `sessionDisplayNames`，不再修改 pi JSONL；Portal 对话框替代 `window.prompt`
- **项目列表**：磁盘项目支持右键「从列表移除」（不删文件夹）

### 设置 · 模型

- **models.json 规整**：加载/保存时 normalize，列表展示非致命 **warnings**
- **手动添加模型**：`ManualModelAddDialog` 支持批量与校验；目录搜索 Enter 快速添加

### 设置 · 提示词

- **全局 SYSTEM.md**：未创建时也可编辑并保存到 `~/.pi/agent/SYSTEM.md`，替换内置 harness（与终端 pi 一致）

### 设置 · 扩展

- **启停与 pi 同步**：开关写入 `~/.pi/agent/settings.json` 的 `packages[].extensions` / `extensions`（± 模式），列表显示 **pi 已启用/已停用**；切换后 reload Worker

### 修复

- 模型设置页 JSX 闭合、扩展页 `Toggle` 组件语法

## [0.3.11] — 2026-06-24

### 性能

- **历史会话快速切换**：点开会话仅拉取时间线尾部（pendingBind + tail），不再在切换时 `session.prepare` 全量 `loadSession`；首条发送、steer/followUp 或 Rewind 跳转时再绑定 Worker
- **Composer 模型展示**：预览未绑定会话时优先 JSONL / pi 默认，避免仍显示上一会话的 runtime 模型

## [0.3.10] — 2026-06-24

### 跨平台顶栏

- **macOS 红绿灯占位**：主对话 `ImmersiveChrome` 与设置页 `TopBar` 在 macOS 下于折叠按钮前增加 72px 占位，避免与 `hiddenInset` 交通灯重叠
- **平台工具复用**：新增 `src/renderer/src/lib/platform.ts`，统一 `isMac` / `isWindows` / `isLinux` 与占位样式，`WindowControls` 改为从该模块导入
- **Linux 无边框**：Linux 与 Windows/mac 一致使用无边框窗口 + 应用内顶栏拖拽与 `WindowControls`，消除系统标题栏与应用顶栏叠层

## [0.3.9] — 2026-06-24

### 修复

- **对话区只显示可恢复 session**：左侧「对话」区域不再把没有 `sessionFile` 的 sandbox 文件夹当作历史对话展示，避免点击后进入项目欢迎页
- **旧状态点击兜底**：如果 Renderer 里残留了无 `sessionFile` 的旧对话行，点击时会先重新查询该 sandbox 的 session；仍找不到就刷新列表并停止，不再切到“要在 … 中做什么？”欢迎页
- **session 选择收紧**：工作区切换只会选择带 `sessionFile` 的可恢复 session，防止无历史文件的占位项清空当前会话

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