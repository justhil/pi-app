# pi Desktop 产品级交付

## 目标

将 pi Desktop 从当前骨架阶段推进到产品级可交付状态，可以打包成 Windows 安装包发给其他开发者使用。

## 当前状态

- 架构设计文档完整（architecture.md + frontend-design.md + 16 spec 文件）
- 项目脚手架能启动，显示三栏 UI 壳
- 27 个 IPC 方法全是 stub，Pi Worker 代码写了但从未真正连过 pi SDK
- 所有面板（Timeline/Review/Run/Trellis/Settings）都是纯展示壳，无真实数据
- 扩展兼容层有白名单逻辑但未接真实插件探测
- 无路由，Settings 点不进去
- 无打包配置验证，无自动更新，无错误恢复

## 交付标准（产品级）

### 必须可用
1. 选项目目录 → 读到 ~/.pi/agent 的已有会话列表
2. 新建/继续/重命名会话
3. 发消息，看到 pi 的流式回复
4. 看到工具调用（read/edit/bash/grep/find）的卡片，可展开看输出
5. 能停止运行中的任务
6. 能 steer / followUp
7. 窗口关了重开不丢会话（依赖 pi session 持久化）
8. 切换模型、设置思维等级
9. Review 面板显示真实 git diff + 工具改文件列表
10. Run 面板显示真实 token 用量/费用/工具统计
11. Trellis 面板读取 .trellis 真实任务状态
12. Settings 6 个页面都有真实功能
13. 扩展兼容层真正探测并跑通 Trellis/Ask/Image 三个 native 插件
14. 完整错误处理：Worker 崩溃能重启，渲染端有 ErrorBoundary
15. 中英文 i18n 完整
16. 打包成 Windows NSIS 安装包
17. electron-updater 自动更新机制
18. 基本使用文档（README + 快速上手）

### 不要求（可后续迭代）
- 多项目同时打开
- 多 Agent 并行
- 云同步
- 插件市场
- 完整 IDE 功能
- 终端嵌入
- macOS/Linux 打包

## 子任务拆分

### 阶段 1：打通核心链路（让 app 真正能用）

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S1 | Pi Worker 真实集成 | Worker 能用 pi SDK 创建 AgentSession，订阅事件，发送 prompt，收到流式回复 | 无 |
| S2 | IPC 真实实现 | 27 个 stub 替换为真实实现，Renderer 能通过 IPC 驱动 Worker | S1 |
| S3 | 会话管理真实实现 | 读取 ~/.pi/agent/sessions/ 目录，列出会话，打开/新建/重命名 | S2 |
| S4 | Timeline 真实渲染 | 订阅 AppEvent，渲染用户消息、助手流式回复、工具调用卡片 | S2 |
| S5 | Composer 真实实现 | 发送 prompt、steer、followUp、abort，图片粘贴 | S2 |
| S6 | 前端路由 | Settings 页面能点进去，主界面和 Settings 之间切换 | 无 |

### 阶段 2：三大面板真实数据

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S7 | Review 面板真实实现 | 三种 scope（turn/session/git）的真实 diff 数据，DiffModel 解析，虚拟列表渲染 | S2 |
| S8 | Run 面板真实实现 | 真实 token 用量/费用/工具统计/运行时长，从 AppEvent 聚合 | S2 |
| S9 | Trellis 面板真实实现 | 调用 .trellis/scripts/get_context.py 读取任务状态，只读 | S2 |

### 阶段 3：Settings 完整功能

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S10 | Settings - General | 启动行为、最近项目、registry 自动检查开关 | S6 |
| S11 | Settings - Appearance | 主题切换（light/dark/system）、字体大小、密度 | S6 |
| S12 | Settings - Pi | 显示 SDK 版本、agentDir、当前模型、auth 概览（不显示密钥） | S2 |
| S13 | Settings - Extensions | 扩展列表、兼容性显示、启用/禁用开关 | S14 |
| S14 | 扩展探测与兼容层 | Extension Probe Process，白名单匹配，blocked 扩展禁用 | S1 |
| S15 | Settings - Resources | skills/prompts/MCP/themes/packages 列表展示 | S2 |
| S16 | Settings - Diagnostics | Worker/Probe/Registry/ResourceLoader/AppEvent 错误日志 | S14 |

### 阶段 4：扩展兼容与远程 Registry

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S17 | Native 渲染器 - Trellis | trellis_subagent 工具的桌面卡片渲染 | S14 |
| S18 | Native 渲染器 - Ask | ask_user_question 的桌面对话框渲染 | S14 |
| S19 | Native 渲染器 - Image | image_gen/image_review 的桌面图片卡片渲染 | S14 |
| S20 | 远程 Registry 拉取 | HTTPS fetch + JSON Schema 校验 + 签名验证 + 缓存 | S14 |
| S21 | 扩展配置页面 | 适配扩展的 JSON Schema Form 配置页面 | S14 |

### 阶段 5：错误处理与恢复

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S22 | Worker 崩溃恢复 | Worker 异常退出时自动重启，恢复会话 | S1 |
| S23 | 渲染端错误边界 | 全局 + Timeline + 面板级 ErrorBoundary，友好降级 | S6 |
| S24 | IPC 超时与重试 | IPC 请求超时处理，Worker 无响应时的用户反馈 | S2 |

### 阶段 6：i18n 完整

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S25 | 中英文 locale 完整 | 所有 UI 文本都有中英文 key，无硬编码文字 | S6,S7,S8,S9,S10-S16 |

### 阶段 7：打包与交付

| # | 子任务 | 目标 | 依赖 |
|---|--------|------|------|
| S26 | electron-builder 打包验证 | NSIS 安装包能生成，安装后能正常启动 | S1-S25 |
| S27 | electron-updater 配置 | 自动更新检查、下载、安装 | S26 |
| S28 | 使用文档 | README 更新 + 快速上手指南 + 截图 | S26 |

## 验收条件

- AC1: `npm run dev` 启动后，选择一个项目目录，能看到历史会话列表
- AC2: 新建会话后发送消息，能看到 pi 的流式回复和工具调用卡片
- AC3: 工具调用卡片可展开查看输出，edit 工具显示 diff
- AC4: 点击停止按钮能中断运行中的任务
- AC5: 关闭窗口重新打开，能恢复到之前的会话
- AC6: Review 面板在三种 scope 下都能显示真实 diff
- AC7: Run 面板显示真实 token 用量和费用
- AC8: Trellis 面板在有 .trellis 的项目中显示真实任务状态
- AC9: Settings 所有 6 个页面都有真实功能，不是空壳
- AC10: Trellis 扩展的 trellis_subagent 工具在桌面端能正常显示进度卡片
- AC11: ask_user_question 在桌面端显示为对话框而非终端交互
- AC12: Worker 异常退出后能自动重启并恢复会话
- AC13: 渲染端任何组件报错不会白屏，显示降级 UI
- AC14: 切换语言后所有 UI 文本正确切换
- AC15: `npm run package:win` 能生成可安装的 .exe
- AC16: 安装后的应用能正常启动和使用
- AC17: 有基本的 README 和快速上手文档

## 参考文档

- `docs/architecture.md` — 系统架构设计
- `docs/frontend-design.md` — 前端规范
- `.trellis/spec/frontend/*` — 前端 spec（6 个文件）
- `.trellis/spec/backend/*` — 后端 spec（5 个文件）
