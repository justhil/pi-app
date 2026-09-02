# R0 功能盘点与精简建议（参考文档）

> 用途：R0「检查现有功能，能简则简，该修就修」的**工作底稿**。不是最终决定，是给后续 review 轮次的清单和线索。
> 日期：2026-08-14（基于 upstream/main 最新：含 Review 面板分组重构、Run/Context 瘦身、completion-alert 合并）
> 盘点方法：按代码结构（`src/renderer/src/features`、`src/main`、`src/worker`、`packages/shared`、`src/extension-compat`）枚举功能 → 用 CHANGELOG 债务史交叉验证 → 找重叠与复杂度热点。
> 规模基线：renderer 功能代码 ~31.8k 行、main ~22.5k 行、worker ~5.2k 行、shared ~4.0k 行、内置适配器 36 个。

## 一、功能清单

### A. 会话与时间线（timeline 7.7k 行 + run 517 + context 221 + stores）

| 功能 | 位置 | 备注 |
|------|------|------|
| 流式 Markdown 渲染（数学公式、代码高亮、表格延迟成型、流式尾字淡显） | timeline/markdown-*、code-block-view | 与 composer 共用样式层 |
| 思考块（thinking-chain-block） | timeline | 独立滚动、时长显示 |
| 工具卡片/折叠组（flat-then-seal、自动展开预算 N=15、+N/−M 统计、文件变更卡片） | timeline/timeline-*、composer-constants | 0.4.x 大量打磨 |
| 消息悬停操作（复制/回退，仅最后一段正文） | timeline/message-hover-actions | |
| 时间线跟滚（上滑不贴底、回底按钮、rAF 合并、窗口隐藏暂停轮询） | timeline/timeline-follow-scroll、stores/ui-store-stream | CPU 打磨史长 |
| Run 面板（本轮状态、上下文环形图、用量） | run/run-panel、context-donut | 与 composer metrics 重叠，见 H4 |
| Context 面板（会话上下文预览） | context/context-panel | 上游已瘦身：与 Run 面板重复的用量统计已删 |
| 外部同步三态指示器（CLI 并发写） | composer 上方 + stores | 0.5.7 完整设计，勿回退 |
| 子 Agent 可视化（子会话只读定位） | timeline + worker child session | 0.5.7 新增 |
| 队列消息（pending queue、Alt+↑ 拉回） | composer/composer-pending-queue | |
| 会话归档/批量恢复/重命名/自动命名 | workspace/archived-*、session-archive | 右键菜单见 H8 |
| 会话 fork/clone（多入口，见 H6） | rewind/session-fork-overlay 等 | |

### B. 会话树与回退（rewind 1.5k 行 + worker 侧）

| 功能 | 位置 | 备注 |
|------|------|------|
| 树面板 + 双击 Esc 浮层；单击=查看跳转、双击=回退 | rewind/tree-panel、session-tree-overlay | 语义已两次改错，勿再动 |
| Git lanes、分支图、引导线、加载更多历史 | rewind/session-tree-git-lanes、graph-column、guide-rails | 可视化复杂度高 |
| 回退恢复文件（pi-rewind 适配器 partial + 内置 navigateTree） | worker/session-branch-actions | 双路径，见 H12 |
| 树旧数据回填、代际 token | stores + main | 0.5.7 加固 |

### C. Composer 输入框（7.0k 行）

| 功能 | 位置 | 备注 |
|------|------|------|
| 附件 chip（文件、行引用 `path:line`、图片粘贴/拖拽） | composer/attachments、clipboard-paste-image | |
| `@` 项目文件模糊搜索 | composer/composer-file-search | |
| `/` 斜杠命令菜单 | composer/composer-slash-popover + main/commands-catalog | 与命令面板重叠，见 H9 |
| 模型/思考等级 pills、模型条 | composer/composer-model-strip | |
| 用量显示（footer + inline） | composer-metrics-footer、composer-metrics-inline | 见 H4 |
| 语音输入按钮 | composer/composer-voice-ui | 链路长，见 H10 |
| 压缩提示条、agent 活动指示 | composer-compaction-banner、composer-agent-activity | |
| 草稿按会话恢复、IME Enter 处理、长输入 caret | composer-transient-draft 等 | 债务修复多 |

### D. 文件预览与 Review（workspace-files 2.0k + review 1.3k）

| 功能 | 位置 | 备注 |
|------|------|------|
| 文件树 explorer（层级、图标、行数限制） | workspace-files/file-tree* | |
| 多标签预览（Ctrl+click）、行号 gutter、宽预览 | file-preview-tab-bar、file-source-preview | |
| Review 面板：Git diff（staged / unstaged 分组 + hunk 暂存 + turn/session 过滤）、行内评论 | review/review-panel、review-hunk-comments、review-inline-comments | 上游刚重构过（2026-08-14），勿与旧 parseGitStatus 逻辑混淆 |
| 行号 gutter「+」插 `path:line` 附件 | review + workspace-files | |
| 回合最终净 diff（turn diff 缓存、基线结算） | worker/turn-file-diff + main turn-diff-store | 见 H3 |

### E. 设置中心（8.8k 行，10 个页面）

| 页面 | 内容 | 备注 |
|------|------|------|
| general | 常规、时间线选项、语言、更新 | |
| appearance | 主题编辑器（浅/深、预设、主色、字体、对比度、导入导出、自定义 CSS） | 见 H2 |
| rightPanels | 右侧面板开关 | |
| pi | pi 设置（env/auth、SDK 区、WSL 发行版管理） | |
| models | 模型管理（catalog、手动添加、SDK 目录浏览、用户配置分离） | 债务最重，见 H1 |
| voice | 语音输入设置 | |
| skills / prompts / extensions / adapters | 资源管理四页 | 见 C 档建议 |

### F. 扩展适配层（extension-ui 1.25k + side-panels 390 + extension-compat）

| 功能 | 位置 | 备注 |
|------|------|------|
| adapter.json 目录（36 个内置适配器、三层覆盖） | src/extension-compat/builtin/* | 见 H11 |
| 对话框壳、问答弹窗（questionnaire） | extension-ui/extension-dialog-shell、questionnaire-* | |
| 自定义配置渲染器、扩展配置子页 | adapter-config-panel、custom-config-renderers、extension-config-subpage | |
| 侧面板 host/registry（adapter 声明面板） | side-panels/* | 与 right-panels catalog 多注册表 |
| Composer 内 adapter widget | composer/composer-adapter-widget-host | |
| MCP 诊断页、Skills Manager 配置页、图片审查对话框 | extension-ui/mcp-diagnostics、skills-manager-config、image-review-dialog | |

### G. 窗口/壳/通知（shell 579 + main 侧通知/托盘系列）

| 功能 | 位置 | 备注 |
|------|------|------|
| 右侧栏 tabs + 收起轨 | shell/right-panel-tabs、side-panels | |
| 命令面板 | shell/command-palette | 见 H9 |
| 应用更新：检查/弹窗/一键升级/忽略 | shell/app-update-dialog + main/app-update-*、github-release-* | 0.5.7 修复过代理 |
| 任务完成通知（窗口几何/快捷键/投递/系统通知，9 个文件） | main/completion-notification-* | 见 H5 |
| 系统托盘 | main/tray.ts | |
| 桌面提醒 + 音频提示 | main/desktop-alerts、audio-trace | 见 H13 |
| 项目侧栏（MRU/固定顺序）、sandbox 分区 | workspace/project-sidebar、sandbox-* | 侧栏闪烁修复史长 |
| 项目/会话/sandbox 三套右键菜单 | workspace/*-context-menu | 见 H8 |

### H. 运行时与后端（main 24.4k + worker 6.1k）

| 功能 | 位置 | 备注 |
|------|------|------|
| SDK 管理（内置/全局/用户、generation 隔离、切换事务、回滚） | main/sdk-manager、sdk-loader、sdk-selection-transaction | |
| Worker 池/会话绑定 | worker/worker-runtime、main/session-bind-state | |
| Preview 隔离进程（会话列表/历史/树解析、系统提示词预览） | main/session-preview-process、system-prompt-preview | 0.5.7 性能关键 |
| WSL 运行时（发行版探测/切换/诊断） | main/wsl/* | 0.5.7 新增 |
| 模型运行时（ModelRuntime、models.json 保存、认证投影） | main/pi-models-json、model-auth-projection、active-sdk-models | 见 H1 |
| 会话目录 watch、外部同步、git workspace watch | main/session-dir-watch、git-workspace-watch | |
| 语音转写（codex-asr 二进制、JWT secret store） | main/asr、codex-transcribe、secret-store | 见 H10 |
| SQLite 会话索引 | main/sqlite-index | 疑似孤儿，见 H7 |
| 安全：sandbox/contextIsolation/safeStorage | main/window、secret-store | THREAT-MODEL 有文档 |

### I. 工程与发布

- CI：typecheck、单元测试（renderer/main/worker/shared 均有）、脚本契约测试、e2e-smoke、依赖审计（critical 门禁）
- 发布：CHANGELOG 按版本维护、Release 正文自动生成、electron-builder 三平台、SBOM
- 文档：README 中英、guide（getting-started/adapters）、CONTEXT、IPC-CONTRACTS、THREAT-MODEL

## 二、交叉评价（重叠与复杂度热点）

| # | 热点 | 证据 | 初步判断 |
|---|------|------|----------|
| H1 | **模型设置页复杂度** | 0.5.2→0.5.7 十余条模型配置修复（未登录模型、重复显示、目录/配置分离、高级字段丢失、SDK 校验兼容……） | 债务最重的模块。手写 JSON 的 UI 映射易错，正是 G2「配置表单」思路的应改造对象 |
| H2 | **主题三轨** | Appearance 编辑器 + 自定义 CSS + 三个 tier:none 主题适配器（amp-themes / curated-themes / themes-bundle，描述几乎相同）+ custom-theme 启动注入 | 三个适配器对桌面端是重复占位，可合并为一个目录条目 |
| H3 | **diff 渲染分散** | review-diff-views、packages/shared/diff-model、diff-split、turn-diff-store、timeline/code-block-view 各自处理 diff；Review 分组化（staged/unstaged）后路径更多 | 建议统一为一个共享 diff 渲染组件 |
| H4 | **用量展示重叠** | composer-metrics-footer + metrics-inline 与 run-panel/context-donut | 上游已删 context 面板的重复统计（47e3187）；剩余 composer 与 Run 面板两处，仍建议收敛为一处为主 |
| H5 | **完成通知 16 个文件** | completion-notification-{controller,delivery,events,geometry,settings,shortcut,system-notification,window-options,actions} 及其测试；上游已合并 completion-alert（弹窗+系统通知双通道） | 该区仍在演进，先观察上游收敛方向；自定义弹窗几何/快捷键复杂度高，若后续无演进可评估砍到纯系统通知 |
| H6 | **Fork 入口 5 个** | /fork、/clone、双 Esc、用户消息 hover、树节点 | 入口过多；建议保留 2 个以内 |
| H7 | **sqlite-index 疑似孤儿** | 0.5.7 后会话列表走 Preview 进程 JSONL 头部扫描；sqlite-index.ts 仅 workspace.ts handler 引用 | 查证消费路径，大概率可删 |
| H8 | **侧栏三套右键菜单** | project/session/sandbox context-menu + archived-context-menu | 已有 context-menu-shared 共享层，评估进一步收敛 |
| H9 | **命令面板 vs 斜杠菜单** | command-palette 与 composer-slash-popover、快捷键体系功能重叠 | 需使用数据；低频则砍 |
| H10 | **语音链路长** | asr + codex-transcribe + voice-ui + voice-settings + audio-trace + secret-store，依赖外部二进制与 ChatGPT/Codex token | 保留为可选项，但收拢到单模块边界内 |
| H11 | **36 个内置适配器** | builtin/*.adapter.json；todo 相关 2 个、主题 3 个（均 tier:none） | 分类审查：tier:none 占位条目合并，低价值适配器降级或移除 |
| H12 | **回退双路径** | 内置 navigateTree（树双击）vs pi-rewind 适配器（/rewind 透传、文件恢复弹窗） | 语义重叠；在文档里写死边界（哪个场景走哪条） |
| H13 | **提醒三件套** | 托盘 + desktop-alerts 音频 + completion-notification 窗口 | 三种提醒形态，评估是否全部必要 |

## 三、精简建议（三档）

### A 档：低风险、可立即做（无需使用数据）

1. **H7**：查证 sqlite-index 是否还有真实调用路径；若无，删除（连同 IPC handler 里的分支）。
2. **H2**：三个主题适配器合并为一个「终端主题包占位」条目；Appearance 编辑器保持不动。
3. **H11**：36 个适配器按 tier 审查一遍：tier:none 的占位条目合并说明；todo 类两个选一个主推。
4. **H5**：completion-notification 的 geometry/window-options/shortcut 评估合并进 controller+delivery 两个文件；自定义弹窗若无人用则退化为纯系统通知。**注意**：上游刚合并 completion-alert 特性（2026-08-14），此区仍在演进，动手前先与上游对齐，避免合并冲突。
5. **H12**：在 CONTEXT.md 写死回退边界：内置树操作负责「导航回退」，pi-rewind 适配器负责「文件/对话恢复弹窗」，互不越界。

### B 档：先收集使用数据再决定

- **H9** 命令面板、**H10** 语音、**H13** 音频/桌面提醒、**自定义 CSS 双轨**、**H4** 用量重叠收敛、**H6** Fork 多入口。
- 方法建议：pi-app 无遥测（这本身是隐私优点，不做上报）；替代方案 = 本地匿名使用计数（只写本机文件，用户可在设置里看/清），或先从 e2e 用例覆盖度 + issue/反馈推断。**这是 R0 需要单独定的一件小事：用什么方式判断"有没有人用"。**

### C 档：借大功能时机重构（不单独立项）

- **H1**：models 设置页借 G2「配置表单」重构——schema 驱动的表单 + 官方读写通道，正好消掉手写 JSON UI 的易错性。
- **设置页资源四页**（skills/prompts/extensions/adapters）：与 G2 插件管理 UI 合并为统一的资源/插件管理界面。
- **H8**：右键菜单收敛可搭 G3/G4 的会话/项目管理顺风车。

## 四、留给后续 R0 轮次的验证问题

1. sqlite-index 的真实消费路径（grep 已显示仅 workspace.ts 一处引用，需确认该 handler 是否仍被 renderer 调用）。
2. IPC 通道使用率：`packages/shared/ipc-channels.ts` 全量清单中，哪些通道已无 renderer 调用方。
3. 36 个内置适配器各自的使用证据（哪些被用户 tier 覆盖过、哪些在 issue 里出现过）。
4. 设置页 10 页的打开频率（决定 B 档里"资源四页合并"是否成立）。
5. e2e 覆盖缺口：哪些核心路径（发送→工具→回退→恢复）没有自动化用例。
