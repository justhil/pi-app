# Changelog

面向仓库的完整版本记录。发版时由 `scripts/generate-release-notes.mjs` 从对应章节生成 **GitHub Release 正文**（用户可读更新说明，应用内「发现新版本」弹窗展示）。发布与应用内更新流程见 [doc/RELEASE.md](doc/RELEASE.md)。

## [0.5.7] — 2026-08-12

### 新增

- **WSL 原生运行时**：支持在指定 WSL 发行版内启动 Pi Worker、读取会话与资源并执行 Git / Preview；设置页可探测、切换和诊断发行版，Host / WSL 切换时会安全停止旧运行时
- **子 Agent 运行可视化**：Composer、Timeline 与侧栏展示子 Agent 的运行进度、预览与结果，支持从父会话只读定位子会话，同时保持后台会话继续运行
- **侧栏项目固定顺序**：可选择固定项目排列；默认仍保留最近使用顺序

### 修复

- **#48 冷启动与首次点击卡顿**：会话列表、历史消息和会话树解析移至独立 Preview utility process，Review Git 快照改为异步；大历史会话与大仓库加载不再阻塞 Electron Main
- **#51 `/skill` 正文污染消息**：模型仍接收完整 Skill 上下文，但 Timeline、历史、排队与输入恢复只显示原始 `/skill:name` 命令；Skill 读取改为“载入 Skill 上下文”语义，不再伪装成普通文件工具
- **#82 内层滚轮被外层抢走**：代码块、Markdown 代码、思考内容及 Context 展开消息拥有独立滚动边界，鼠标滚轮不再带动外层 Timeline / 面板
- **#41 更新检查与系统代理**：手动检查明确区分“有更新 / 已是最新 / 检查失败”，更新包下载统一使用 Electron 网络栈，遵循系统代理与 PAC
- **#40 模型设置与当前 Pi SDK 不一致**：默认模型和 Composer 只显示用户配置或已登录可用模型；用户供应商与 Pi SDK 只读目录分层展示，避免混淆
- **无 Worker 时设置无法保存**：冷启动后未打开会话也可保存 Pi 默认模型和全局设置；Host、global / user SDK 与 WSL 均使用 SDK `SettingsManager` 的合并和锁语义
- **多 Worker Extension UI 串话**：问答弹窗按请求来源路由响应与取消；后台 Worker 不再覆盖或取消前台弹窗，Worker 退出和会话切换会清理悬挂请求
- **会话状态隔离**：瞬时 Worker 状态查询失败不再误判 idle；切换会话、Home 或新会话时清除旧运行快照，停止按钮和运行标记不再跨会话复活
- **会话树旧数据回填**：打开或切空会话时刷新请求代际，迟到的旧会话树不会覆盖当前视图
- **长输入光标不可见**：Composer 超过最大高度后保持 caret 可见，并消除 MutationObserver / caret probe 的反馈循环
- **小窗口布局覆盖用户偏好**：窄窗仅临时压缩左右面板，放大后恢复持久化宽度

### 优化

- **模型列表即时打开**：应用启动后预热共享可用模型缓存；Composer、`/model` 与默认模型下拉立即显示缓存并后台刷新，失败时保留旧选项
- **大型会话列表性能**：读取会话标题和工作区信息时只扫描 JSONL 头部，不再加载整个 transcript
- **项目切换体验**：按工作区缓存会话列表，减少切换时清空、闪烁与排序跳动；新建或 Fork 后优先使用实时列表
- **SDK 安装与切换安全性**：user SDK 使用独立 generation 路径避免 ESM 旧模块缓存；验证失败可回滚到原 user generation，并同步刷新 Preview 与模型目录

### 注意

- WSL 模式需要目标发行版内可用的 Node.js 与 Pi SDK；切换发行版后会重启相关 Worker / Preview 进程
- “用户配置的供应商”仍只写 `~/.pi/agent/models.json`；“当前 Pi SDK 供应商”是脱敏只读目录，不会回写 `auth.json` 或 `models-store.json`

## [0.5.6] — 2026-08-03

### 修复

- **模型管理页显示未登录模型**：修复 `0.5.5` 将 Pi 支持的完整内置目录全部列出的问题；现在只显示 `models.json` 中用户明确配置的模型，以及当前 Pi SDK 明确认定为可用的模型
- **重复模型显示**：用户配置与 SDK 可用列表存在同一 provider / model 时只显示一次，并以用户配置为准

### 优化

- **模型来源语义对齐**：模型管理页现在与 Composer 一样使用 Pi 的可用模型判断，不再把目录缓存误当作登录状态
- **配置与缓存继续隔离**：SDK 可用模型只作为展示和添加候选，保存时仍只写用户编辑的 `models.json`

### 注意

- `models-store.json` 是 Pi SDK 管理的动态目录缓存，不等同于登录状态；Desktop 不会直接编辑或按文件是否存在判断模型可用性
- `models.json` 中显式配置的 provider 与模型仍会全部显示，即使它们当前未登录

## [0.5.5] — 2026-08-02

### 修复

- **#40 模型目录与 Pi CLI 不一致**：设置页现在通过当前 Pi SDK 读取完整模型目录；即使 `models.json` 不存在、模型只保存在 `models-store.json`，或配置文件只有 overrides，供应商与模型仍会正常显示，无需复制或重命名文件
- **模型配置保存丢失高级字段**：编辑基础字段后，不再删除 Pi 支持的 `oauth`、headers、compat、cost、modelOverrides，以及 `thinkingLevelMap` 中明确设置的 `null`；未来 SDK 新增且校验通过的字段也会原样保留
- **模型配置写入与重载诊断**：损坏的原配置不会被草稿覆盖，非法配置不会落盘；写入成功但运行中的 Worker 重载失败时会单独报告，避免把部分成功误报为完整成功

### 优化

- **Pi 0.83 运行时兼容**：内置 `@earendil-works/pi-coding-agent` 升级至 `0.83.0`，模型切换、可用模型目录与配置重载统一使用 Pi 的 `ModelRuntime`，修复使用新版全局 / 用户 SDK 时的模型列表与刷新异常
- **模型目录与用户配置分离**：设置页可浏览 SDK 完整目录，但只保存用户实际编辑的 `models.json`；缓存目录不会被反写进配置，重复模型也会自动去重
- **模型配置安全性**：保存继续由 Main 进程负责 SDK 校验、同目录临时文件与原子替换；API key 不会出现在错误提示或测试快照中

### 注意

- 设置页中的 catalog-only 供应商和模型默认只读；需要自定义时请先添加供应商或把模型加入用户配置
- 模型管理页展示完整目录，Composer 仍只显示 Pi SDK 明确认定为可用的模型，两处列表用途不同

## [0.5.4] — 2026-08-02

### 修复

- **模型配置与 SDK 环境切换**：供应商配置恢复可保存，并兼容当前与旧版 Pi SDK 的校验接口；独立 / 全局 SDK 切换会等待 Main 与 Worker 确认，失败时明确提示并回滚，不再出现假成功或无效操作
- **模型目录与当前会话模型**：设置页从 active SDK 读取完整模型目录，Composer 只展示已登录或已配置的可用模型；当前会话切换以 Worker 实际状态为准，包含 `/` 的模型 ID 与新会话首条消息也能使用正确模型
- **设置页清空 Composer 草稿**：打开设置再返回后，未发送文字与附件顺序仍保留；草稿按会话隔离，发送或手动清空后不会错误恢复
- **历史查看误报回退**：单击历史节点只查看，双击、Enter 或明确按钮才执行回退；查看、回退和 Fork 不再混淆
- **启动语言与设置页文案**：补强首屏语言恢复回归门禁，确保已保存语言仍在 React 挂载前生效；移除设置页标题前多余圆点和重复标题
- **Windows 系统托盘**：恢复 Tray 图标，支持左键显示并聚焦窗口，右键显示 / 隐藏窗口或退出应用

### 优化

- **macOS 双架构安装包**：Release 同时构建 Intel x64 与 Apple Silicon arm64 的 DMG / ZIP
- **模型选择可信度**：无法确认当前鉴权状态时不再用完整模型目录冒充可用列表，避免选到未登录 Provider
- **发布门禁**：修正 IPC schema、UI store 持久化与平台相关测试契约，并拆分过大的 UI store 壳状态，确保类型检查、单元测试、脚本契约与构建通过
- **README 赞助入口**：中英文 README 增加项目赞助二维码

### 注意

- 设置页的模型目录用于浏览和配置，可包含尚未登录的 Provider；Composer 模型选择器只显示 Pi SDK 明确认定为可用的模型
- macOS unsigned 构建仍可能被 Gatekeeper 拦截；签名与公证取决于 Release 环境是否配置 Apple 凭据

## [0.5.3] — 2026-07-30

### 修复

- **会话切换后 Composer 模型与上下文不刷新**：切换 session 后立即把目标 session 绑定到 Worker，输入框显示的模型和上下文统计随当前会话更新，不再显示上一个会话的状态
- **对话前选的模型被默认设置覆盖**：新会话建立时会同步 UI 中已选择的模型和思考等级，不再回退为设置页默认值
- **思考时长越用越大**：assistant 流结束时记录真实 thinking 耗时，完成后显示固定秒数，每次打开应用不再继续累加
- **Worker 未启动时无法切换模型/思考等级**：未打开项目时选择模型或 thinking level 不再报 `Worker not started` 错误，选择会在开始会话后生效
- **右侧面板被拖到无法展开**：本地持久化的右侧布局状态默认重置，避免宽度被拖到 0 后无法恢复

### 新增

- **右侧边栏支持拉满主对话区**：带鱼屏用户可将右侧面板拖到更宽，方便查看文件、Review 与 Run 面板内容
- **仓库添加 MIT LICENSE**：根目录加入 MIT 许可证文件，明确项目授权

### 优化

- **右侧面板拖拽保留安全间距**：右栏拉到最大时与左侧边栏保留 120px 间距，避免拖拽手柄被完全盖住无法恢复
- **检查更新改为非阻塞并行**：启动后后台检查 GitHub Release，结果通过 IPC 事件推送，不阻塞主窗口加载
- **设置页增加 GitHub 主页按钮**：一键访问项目仓库

## [0.5.2] — 2026-07-28

### 新增

- **自定义浅色 / 深色主题**：可分别配置两套主题，支持内置预设、手动调整主色、背景、文字、对比度与界面字体，并随系统主题自动切换
- **主题导入与导出**：支持复制和导入 `pi-theme-v1` 字符串，也兼容 `codex-theme-v1`；导入前会展示预览与不支持字段数量，确认后一次性应用
- **高级自定义 CSS**：可在外观设置中独立启用、停用或清空 CSS 覆盖，不影响结构化主题配置

### 优化

- **设置页信息架构**：导航按应用、Agent 与资源重新分组，统一页面标题、表单控件、按钮、图标与字体层级，减少视觉噪声
- **主题启动体验**：主题与自定义 CSS 在首帧前恢复，降低启动闪烁；浅色与深色配置互不覆盖
- **差异与状态颜色**：Review 与 Timeline 共用语义化增删色，在默认主题和自定义主题下保持一致

### 注意

- 代码高亮仍由 Shiki 主题控制，不会跟随自定义界面主题；导入时会忽略 `codeThemeId` 和 `semanticColors.skill` 等暂不支持字段
- 若错误的自定义 CSS 导致界面不可用，可使用 `--disable-custom-theme` 启动应用，再进入设置修正或清空配置

## [0.5.1] — 2026-07-27

### 修复

- **流式输出时切换会话丢失刚发的消息**：切出再切回后，最后一条已发送的用户消息不再消失。合并链路不再丢弃尚未落盘的乐观消息行，已流出的部分回答文本同样保留
- **会话结束后状态残留**：流式中切走再切回、本轮在前台结束后，过期的「运行中」缓存不再复活——不再出现运行角标误亮、发送被误路由到 steering 队列导致消息无响应、以及发送后乐观显示缺失的问题

## [0.5.0] — 2026-07-26

### 新增

- **#31 Composer `@` 项目文件搜索**：在消息开头或空白后输入 `@`，即可模糊搜索当前项目文件和目录；支持键盘、鼠标、目录继续补全、hidden 文件、`.gitignore`、symlink，以及空格 / Unicode / Windows 路径

### 修复

- **模型设置页国际化失效**：模型供应商页面的标题、按钮、提示和校验信息恢复中英文翻译，不再直接显示 i18n key
- **Global / User SDK 模型配置崩溃**：模型配置校验与可用模型读取同时兼容内置 SDK 0.80.7 和新版 `ModelRuntime` API，不再出现读取 `.create` 的异常
- **聊天框模型选择被默认设置覆盖**：设置页默认模型仅用于新会话，保存设置不再切换当前会话已选择的模型
- **#30 模型配置保存后仍提示未保存**：保存成功后会同步清除设置页脏状态；保存失败仍保留未保存提示
- **#32 手动检查更新无法读取 GitHub Releases**：更新请求改用 Electron Chromium 网络栈，兼容系统代理和 PAC；保留 token、超时及 latest 404 fallback 行为
- **#33 macOS 提示应用已损坏**：Apple 凭据齐全时自动签名、公证并执行 Gatekeeper 验证；凭据缺失时仍发布 unsigned DMG / ZIP，不再阻塞整次 Release
- **中文输入法 Enter 误发送**：IME 组词期间的 Enter 不再触发补全或发送
- **流式 Markdown 表格延迟成型**：流式尾部出现表格等块级语法时改用 Markdown 渲染
- **思考内容滚动串联**：展开的思考内容拥有独立滚动区，鼠标滚轮不再带动整条 Timeline
- **窄窗启动后输入框高度异常**：Composer 会在窗口、侧栏或中心列宽度变化后重新测量内容高度；程序化填充、清空和历史恢复也会自动复位，不再保留窄窗下的异常多行高度

### 优化

- **对话区宽度与思考可读性**：侧栏收起后对话区按中心列自适应放宽；思考正文提升字号、行高和对比度
- **文件引用兼容性**：项目文件以现有附件 chip 展示，发送保持 `@path`；含空格路径使用引号，避免引用被截断

### 注意

- macOS 构建若未配置 Apple Developer ID 与公证凭据，下载到的 unsigned 版本仍可能被 Gatekeeper 拦截；需要签名版本时请等待带签名资产或手动移除 quarantine

## [0.4.20] — 2026-07-20

### 修复

- **#24 关闭扩展按钮无效**：扩展启停规则改为以 Pi settings 资源根为基准，正确写入 `-extensions/...`，与 pi-coding-agent 的资源加载路径保持一致
- **#25 macOS GUI 环境变量不完整**：Finder / Dock 启动时同步 login shell 环境，provider key、代理及工具链变量会传递给 Worker 和后续子进程；保留启动器显式变量并过滤 Electron 控制变量
- **#26 启动首屏语言错误**：首次 React 渲染前恢复已保存语言，不再需要进入设置页后才切回中文；同时同步 HTML 文档语言

### 优化

- **Pi 运行时兼容性**：内置 `@earendil-works/pi-coding-agent` 更新至 0.80.7
- **主进程测试门禁**：Vitest 纳入 `src/main` 单元测试，并补充扩展路径、login shell 环境与启动语言回归用例

## [0.4.19] — 2026-07-12

### 修复

- **#19 历史会话模型被静默换成 Claude**：会话保存的模型无法恢复时，SDK 会 fallback；现将 `modelFallbackMessage` 以 toast 明确提示，不再只写 Worker 日志
- **绑定后 Composer 模型展示**：Worker 已绑定当前会话时，以 runtime 模型为准，JSONL / lastModel 不再盖住真实发送模型

## [0.4.18] — 2026-07-12

### 新增

- **软件内更新提醒与一键升级**：启动后后台检查 GitHub Releases（不阻塞 UI；失败静默）；有更新时弹窗展示 Release 更新说明，支持 **本次忽略** / **忽略本版本** / **更新**（下载安装包并自动启动安装程序）
- **Release 正文生成**：CI 从 CHANGELOG 生成用户可读 Release body，禁止仅放 CHANGELOG 链接占位；应用内公告即该正文
- **侧栏代码预览高亮**：内置更多语言的 Shiki 高亮（按需加载）；预览不再自动折叠长文件

### 修复

- **#21 更新后会话列表为空**：打包不再用 `!**/doc/**` 误删 `yaml` 运行时 `dist/doc/directives.js`，修复 `session.list` / Worker 初始化 `MODULE_NOT_FOUND`
- **更新检查竞态**：检查结果可在 renderer 订阅前缓冲，挂载后通过 pending 拉取，避免漏弹窗

### 注意

- 从 0.4.15–0.4.17 受 #21 影响的安装包请升级到本版本；磁盘上会话文件一般仍在，升级后即可重新列出

## [0.4.17] — 2026-07-12

### 新增

- **Paper Agent 时间线节奏**：开段工具/思考平铺展示，后续正文出现后再折叠为汇总行（flat-then-seal）
- **Files Changed 卡片**：仅挂在最后一轮已完成输出；文件过多可折叠展开；右侧 Review 入口
- **工具行 +N/−M**：edit/write/insert 摘要行显示高对比 diff 统计；汇总行同步徽章
- **流式字尖淡显**：正文流式保留源文本实时性，仅对尾部 ≤2 字做软淡入

### 优化

- **时间线密度**：去掉正文消息固定 32px 操作占位；悬停时行内展开操作区
- **消息操作范围**：同一回合只在「最后一段正文」显示复制/回退，中间桥接正文不再挂操作条
- **工具自动展开预算**：`timelineMaxAutoExpandedTools` 对本 run 最近 N 个工具生效（含已完成）
- **显示壳视觉**：活动行/正文/Markdown 表格与段落间距收紧，折叠段与上下文更贴合

### 修复

- **误报「回复未完成」**：工具桥接空 assistant 不再标 incomplete / interrupted
- **工具折叠无法展开**：折叠组与单工具改为条件渲染 + 本地展开状态，点击可靠
- **折叠闪烁**：开段不提前建层级；密封后稳定 groupId；展开策略不再因 phase 抖动收起

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.17/CHANGELOG.md)

## [0.4.16] — 2026-07-11

### 新增

- **Cursor 风格 Agent 时间线**：工具组活动摘要（Edited / explored / commands +diff）、回合结束「文件变更」卡片，可联动右侧 Files / Review
- **行引用附件**：Review / Files 行号 gutter「+」将 `path:line` 以附件 chip 形式插入输入框
- **右侧栏收起轨**：收起时保留窄图标轨与运行态指示，一键展开对应面板
- **Run 上下文构成**：上下文预览按 system / user / assistant / tool 等角色占比展示（环形图）

### 优化

- **时间线 / Markdown**：代码块与工具卡片背景、圆角与文案更克制；工具图标统一为中性字形
- **工具合并**：仅含 thinking 的助手气泡不再打断多工具合并组
- **Tree / Run 面板**：层级引导与状态条视觉整理；错误态弱化为柔和提示

### 修复

- **斜杠 `/skill:name`**：不再被 sticky 前缀误匹配到 Skills Manager 配置页；裸 `/skill` 仍打开配置，`/skill:enable` 与 `/goalfoo` 行为保持
- **Composer 附件 key**：同路径多 chip 使用稳定 `chipId`，避免 React 重复 key 警告

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.16/CHANGELOG.md)

## [0.4.15] — 2026-07-10

### 新增

- **会话 Fork / Clone 语义对齐 TUI**：Worker 迁到 `AgentSessionRuntime`；真实 `/fork`（新会话文件 + 原文 prefill）与 `/clone`（复制当前分支）
- **桌面入口**：`/fork`、`/clone`、双 Esc（`doubleEscapeAction=fork`）打开 Fork 选择器、用户消息 hover Fork、会话树用户节点 Fork；成功后自动切换到新会话

### 优化

- **pi-rewind 适配器**：`tier` 由 `none` 调整为 `partial`，设置页不再误标「仅终端」；说明桌面支持恢复文件/对话弹窗（`/rewind` 仍透传扩展）

### 修复

- **会话树 / 历史**：加载更多历史、lazy Worker 下 rewind 路径与 CI 契约测试加固（含 Windows TAP 计数）

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.15/CHANGELOG.md)

## [0.4.14]## [0.4.15] — 2026-07-10

### 新增

- **侧栏项目右键**：支持「在资源管理器中显示」，快速打开项目路径

### 优化

- **会话生命周期**：Session Shell 缓存（最多 12）、切会话即时绑定、磁盘优先读历史；流式切出切回保留更完整时间线
- **运行态按会话分桶**：Composer 停止键与顶栏「运行中」仅反映当前查看会话；停止/abort 路径与 Windows 路径规范化补强
- **回退与中断恢复**：leaf 覆盖、空/不完整助手气泡可回退；强制退出后尽量落盘中断状态
- **时间线跟滚**：上滑不强制贴底；近底再跟流；回底按钮与适中流式尾空白
- **CPU / 流畅度**：流式贴底 rAF 合并、结构派生缓存、后台 delta 批处理、窗口隐藏时暂停轮询
- **主题与外观**：深色启动 hydrate 与 VS Code Modern 相关体验整理

### 修复

- 流式输出时切出会话再切回卡住加载 / 少渲染 / 只剩当前流式一条
- 回退第一条后误显示加载动画；回退与会话切换卡顿
- 停止键无效、运行结束后输入框状态不更新
- 输入框 placeholder 在回退预填与输入空格时不消失
- 剪贴板图片保留等边界问题

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.14/CHANGELOG.md)

## [0.4.13] — 2026-07-06

### 修复

- **会话重命名与 pi TUI 对齐**：GUI 重命名写入会话 JSONL `session_info`（与 `/name`、TUI 会话列表 rename 相同）；侧栏标题优先读 pi `name`，TUI 改名后 GUI 刷新即同步；成功后清除旧版 `sessionDisplayNames` 覆盖，避免双标题

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.13/CHANGELOG.md)

## [0.4.12] — 2026-07-06

### 优化

- **流式正文渲染**：助手回复采用稳定 Markdown 前缀 + 尾部纯文本，减少整段重解析抖动；光标与行高更接近常见聊天产品观感
- **时间线**：按轮次分组与底部锚点；会话打开/切回时 live 时间线合并与同步策略补强
- **Review**：差异视图与行内评论交互整理
- **工具卡片**：原生工具预览与摘要展示小幅调整；当前 run 内仅最近 N 条工具自动展开详情（默认 15，**设置 → 常规 → 时间线** 可调 1–50），减轻长对话卡顿
- **时间线跟滚**：流式/工具增高时双帧贴底；Agent 运行中默认跟随底部，用户上滑后不再抢滚动
- **等宽字体**：内置 **Geist Mono**（SIL OFL 1.1）用于代码块、bash 输出、工具名与 diff；界面正文仍用系统 sans

### 修复

- **设置 · Pi**：进入 Pi 页不再因每次全量全局 SDK 探测 + npm registry 阻塞主进程 IPC 卡顿 5–10s；`sdk.status`/registry TTL 缓存，registry 后台补齐
- **Composer 停止键**：`composerTurnActive` 在本地 turn 活跃时不再因 worker 快照仍指旧会话而隐藏；运行中轮询 runtime；`loadHistoryItems` 保留当前会话 running
- **时间线工具顺序**：流式回合中工具先执行时，工具行插入空助手气泡之前，避免正文显示在工具卡片后面
- **流式正文夹杂 JSON**：`toolcall_delta` 的工具参数片段不再误并入助手气泡（`pi-message-update` 映射）
- 时间线 live 合并、历史 prepend、轮次耗时与底部锚点拆分；后台会话事件与时间线投影等边界用例补充测试
- **时间线 React key 冲突**：多条用户消息共用同一 `sessionEntryId` 时回合分组 key 重复；改为以用户消息 `id` 作为回合 id

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.12/CHANGELOG.md)

## [0.4.11] — 2026-07-06

### 新增

- **后台会话并行**：切到其它会话预览时，原会话 Agent 可在后台继续跑；回到该会话可恢复流式进度与排队状态
- **会话时间线离线预览**：未绑定 Worker 时也可从会话 JSONL 直接加载时间线分页，浏览历史分支与叶子节点
- **思维链展示**：助手消息中的 thinking 块按顺序拼接展示，与 pi TUI 行为对齐
- **时间线滚动指示条**：聊天时间线右侧显示可拖拽的细滚动条（右栏展开贴栏边、收起贴主列右缘）
- **会话树 Git 风格导引**：回溯树可选分支导引线与节点类型图标，大树自动退回纯列表以保证性能
- **扩展工具卡片**：搜索/子 Agent/生图/问卷等工具按通用模板（列表、树、媒体、键值）展示；支持工作区内联图片预览与导出文件快捷打开
- **Composer 粘贴图片**：支持从剪贴板粘贴图片为附件（含大小与临时文件策略）
- **发布物校验**：Release 流程可生成安装包校验和与 SBOM 清单（CI 配套脚本）

### 优化

- **会话事件路由**：以会话 JSONL 路径作为稳定键，切换预览会话时后台流式事件写入缓存，减少错会话、丢流式内容
- **工具输出安全**：代码高亮与工具摘要经 HTML 消毒后再渲染，降低恶意输出注入风险
- **设置页**：模型、Pi 配置、语音、扩展等面板拆分与交互整理，加载与保存更稳定
- **Review 差异视图**：代码审查侧栏 diff 展示组件化，便于大 diff 浏览
- **macOS 启动环境**：修正 GUI 应用下终端工具 PATH，改善语音/子进程调用外部命令的成功率
- **依赖升级**：同步 pi-coding-agent 0.80.3、Electron 43、better-sqlite3 12 等运行时与构建链

### 修复

- 设置侧栏「语音」导航文案显示异常（延续 0.4.10 补丁）
- 时间线与文件树「加载更多」条数插值显示异常（延续 0.4.10 补丁）
- 预览其它会话时后台运行状态与时间线不同步、切回后流式内容丢失或错位
- 扩展工具卡片在部分插件下仅显示原始 JSON、无法识别图片路径或子任务进度
- Linux CI / 本地 E2E 在无显示环境下启动 Electron 失败（`PI_E2E`、显式路径与 xvfb）
- **语音 Codex Token**：保存后重进设置被清空；仅改其它项保存时误删 safeStorage 中的 Token；界面增加「已保存」提示与清除入口
- **设置 · 扩展**：包内插件禁用后无法再次启用（开关未写入 `+` pattern）
- **设置 · Pi 全局 SDK**：全局版本检测改为多源（优先 `npm i -g` 的 list/prefix/root 与标准全局 `node_modules`，再 `where pi`、pi-node 布局）；打开 Pi 设置时刷新缓存；兼容 Windows `npm.cmd` 与仅 pi-node 安装、未写入 Roaming npm 的场景
- CI：`test:unit` 缺少 vitest setup、Worker parity 浅克隆、jest-dom 类型、Windows CRLF 契约测试、eslint 历史 fixture

### 质量保障

- 新增 Vitest 单元测试与大量契约/回归脚本（IPC 边界、会话路由、Worker 分发、剪贴板策略等）
- CI 使用 Node 22；Release 构建 `npm ci` 失败自动重试；质量流水线补充审计项

> GitHub Release 正文链接本文件：[CHANGELOG.md](https://github.com/justhil/pi-app/blob/v0.4.11/CHANGELOG.md)

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
