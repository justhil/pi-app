# pi Desktop MVP - 完整桌面端 AI Agent GUI

## Goal

构建一个面向个人开发者的 pi 桌面 GUI 应用（Electron + React），将 pi 的会话、工具调用、代码改动、运行状态、Trellis 任务状态和项目资源变成可视化桌面体验。第一版是"pi 的好用外壳"，第二阶段再演进成多项目多任务工作台。

完整架构设计见 `docs/architecture.md`，前端规范见 `docs/frontend-design.md`，编码规范见 `.trellis/spec/`。

## Parent Task Scope

本任务是**长线总任务**，不做直接实现，而是：

1. 持有完整项目目标和需求集。
2. 拆分为可独立规划、实现、验收、归档的子任务。
3. 管理跨子任务的依赖顺序和集成验收。
4. 最终验收：完整 pi Desktop MVP 可交付。

## Requirements

### R1: 项目脚手架与构建
- Electron + electron-vite + React + TypeScript 项目初始化。
- 主进程 / preload / renderer / worker / shared 分层目录。
- Tailwind CSS + shadcn/ui (new-york + zinc) 配置。
- electron-store + SQLite 依赖安装。
- i18next + react-i18next 配置，中文 locale 文件。
- Geist Sans + Geist Mono 字体集成。
- Motion token CSS 变量定义。

### R2: Electron 主进程与安全
- nodeIntegration: false, contextIsolation: true, sandbox: true。
- preload 白名单 IPC API。
- 应用菜单（File / Edit / View / Window / Help）。
- 窗口生命周期管理。
- electron-builder + NSIS 打包配置。
- electron-updater 自动更新框架。

### R3: Pi Worker 与 IPC 契约
- utilityProcess 创建 Pi Worker。
- MessageChannel 双向通信。
- packages/shared IPC 契约定义（完整方法列表）。
- AppEvent 类型定义 + zod/typebox 校验。
- Event normalizer：pi SDK event → AppEvent。
- Worker 生命周期：一个项目一个 Worker，切项目换 Worker。
- 复用 ~/.pi/agent 配置（auth / models / settings / sessions）。

### R4: 会话管理
- 会话列表（当前项目下）。
- 新建 / 打开 / 重命名 / 删除会话。
- fork / clone 会话。
- compaction 处理（Timeline 分隔标记 + 摘要展开）。
- session export。
- 会话右键菜单（重命名、删除）。

### R5: Timeline 主区域
- 用户消息展示。
- AI 回复流式渲染。
- 工具调用卡片（read / write / edit / bash）。
- bash 输出折叠展示。
- edit diff 片段内联展示。
- 工具卡展开/折叠。
- 错误状态展示。
- compaction 分隔标记。
- 新卡片入场动效（fade + translateY, 200ms）。
- Timeline 区域 ErrorBoundary。
- 消息右键菜单（复制）。

### R6: Composer 底部输入区
- 多行输入框。
- 模型选择入口。
- thinking level 选择。
- 发送 / 停止按钮。
- 斜杠命令补全（/ 触发，走 IPC commands.list）。
- 图片粘贴（Ctrl+V）。
- 图片拖拽到窗口。
- prompt.steer / prompt.followUp 支持。
- 发送→Stop 按钮状态切换动效。

### R7: Review 面板
- Turn / Session / Git 三种范围切换。
- edit/write 工具事件归因。
- turn 前后 git diff 快照。
- DiffModel 统一模型。
- inline diff 渲染。
- 大文件 / lockfile / generated 折叠。
- binary 文件摘要。
- 复制路径。
- 打开外部编辑器。
- 文件右键菜单（复制路径、打开文件）。
- 虚拟列表渲染长 diff。
- Git 只读（不 commit / stash / checkout）。

### R8: Run 面板
- Running / Idle / Failed 状态。
- 当前模型 + thinking level。
- 耗时。
- token / cost。
- 工具调用数量 + 错误数量。
- 当前活动工具。
- 细进度条（运行中）。

### R9: Trellis 只读面板
- TrellisReader 实现（优先官方脚本，fallback 读文件）。
- 当前任务 / 阶段 / 验收条件 / 最近 journal。
- 无 .trellis 时显示"未启用 Trellis"。
- 只读红线：禁止调用修改 .trellis 的命令。
- 刷新策略（进入项目 / 切 session / 手动刷新 / mtime 变化）。

### R10: Settings 页面
- General：启动行为、最近项目、registry 自动检查。
- Appearance：Light / Dark / System、字体、density。
- Pi：SDK version、agentDir、当前模型、settings、sessionDir、auth 概览。
- Extensions：兼容等级、启用/禁用、JSON Schema 配置表单、风险提示。
- Resources：skills / prompts / MCP / themes / packages 展示。
- Diagnostics：Worker 状态、probe 结果、registry 日志、错误。

### R11: Extension UI Compatibility Layer
- Extension probe process 探测注册结果。
- 兼容等级判断（native / basic / headless / blocked）。
- 首批 native adapter：Trellis / Ask / Image。
- blocked extension 默认禁用 + 用户手动启用 + 风险提示。
- active tools 过滤 fallback。
- App 运行时覆盖，不改 pi settings。

### R12: Remote Adapter Registry
- built-in registry。
- 远程 GitHub JSON 拉取 + Ed25519 签名校验 + JSON Schema 校验。
- rendererId 白名单校验。
- 每天最多一次自动检查，失败静默用缓存。
- Settings 手动刷新 / 关闭。
- registry 更新不在 running turn 中途生效。

### R13: Extension 配置页
- JSON Schema Form 渲染。
- 配置存 App 本地（workspaceId + extensionId）。
- 不写 pi settings。

### R14: Extension 原生卡片
- Trellis 子 agent 进度卡片。
- Ask 选择/确认/输入卡片。
- Image 生成/审查卡片。
- 交互位置规则（modal / timeline card / run panel / preview）。

### R15: 本地存储
- electron-store 轻配置。
- SQLite 索引缓存（workspace / session / run / turn / file_change / extension_discovery / registry_cache）。
- pi session JSONL 是事实来源。

### R16: 错误处理与恢复
- Worker crash 自动重启 + pi session 恢复。
- extension 加载失败不阻塞 session。
- registry 失败静默降级。
- 前端三层 ErrorBoundary（全局 + Timeline + per-card）。
- 所有后端错误进 Diagnostics。

### R17: i18n
- i18next + react-i18next 配置。
- 所有 UI 文案走 i18n key。
- 第一版中文 locale 完整。
- 英文 locale 预留空值。

### R18: 系统集成
- OS 通知（agent 完成提醒）。
- 最小应用菜单。
- 不做系统托盘、全局快捷键。

## Acceptance Criteria

- [ ] AC1: 用户能打开一个项目文件夹，看到该项目的会话列表。
- [ ] AC2: 用户能新建会话、发送 prompt、看到 AI 流式回复。
- [ ] AC3: 用户能看到工具调用卡片（read/write/edit/bash），bash 输出可折叠。
- [ ] AC4: 用户能在 Review 面板切换 Turn/Session/Git 查看代码改动 diff。
- [ ] AC5: 用户能在 Run 面板看到当前运行状态、模型、耗时、token/cost。
- [ ] AC6: 用户能在 Trellis 面板看到当前任务、阶段、验收条件（如果有 .trellis）。
- [ ] AC7: 用户能在 Composer 切换模型、thinking level、用斜杠命令。
- [ ] AC8: 用户能在 Settings 管理 Extensions 启用/禁用、查看 Resources。
- [ ] AC9: Trellis extension 的子 agent 进度能以原生卡片展示。
- [ ] AC10: Ask 类工具的交互能以桌面 modal/card 展示。
- [ ] AC11: Image 类工具的生成结果和审查能以桌面卡片展示。
- [ ] AC12: 未兼容 extension 默认禁用，用户手动启用时有风险提示。
- [ ] AC13: 远程 registry 能自动拉取并校验，更新 extension 兼容声明。
- [ ] AC14: Worker 崩溃后能自动重启并恢复会话历史。
- [ ] AC15: 所有 UI 文案走 i18n key，无硬编码字符串。
- [ ] AC16: 能用 electron-builder 打包出 Windows NSIS 安装包。
- [ ] AC17: 整体 UI 符合 frontend-design.md 的风格约束（无 AI slop）。

## Sub-Task Map

### 阶段一：基础设施（无依赖）

| 子任务 | 对应需求 | 说明 |
|--------|---------|------|
| scaffold | R1 | 项目脚手架、构建、依赖、字体、token |
| electron-main | R2 | 主进程、安全配置、菜单、窗口、打包 |
| ipc-contract | R3 | IPC 契约、AppEvent 类型、shared 包 |
| pi-worker | R3 | Worker 进程、SDK 集成、event normalizer |
| i18n-setup | R17 | i18next 配置、locale 目录、中文翻译 |

### 阶段二：核心功能（依赖阶段一）

| 子任务 | 对应需求 | 依赖 |
|--------|---------|------|
| session-mgmt | R4 | ipc-contract, pi-worker |
| timeline | R5 | ipc-contract, pi-worker, i18n |
| composer | R6 | ipc-contract, pi-worker, i18n |
| review-panel | R7 | ipc-contract, pi-worker |
| run-panel | R8 | ipc-contract, pi-worker |
| trellis-panel | R9 | ipc-contract |
| local-storage | R15 | electron-main |
| error-recovery | R16 | electron-main, pi-worker |

### 阶段三：扩展与配置（依赖阶段二）

| 子任务 | 对应需求 | 依赖 |
|--------|---------|------|
| settings | R10 | i18n, local-storage |
| extension-compat | R11 | pi-worker, ipc-contract |
| remote-registry | R12 | electron-main, extension-compat |
| extension-config | R13 | extension-compat, settings |
| extension-cards | R14 | extension-compat, timeline |

### 阶段四：集成与交付（依赖全部）

| 子任务 | 对应需求 | 依赖 |
|--------|---------|------|
| system-integration | R18 | electron-main |
| package-release | R16 AC16 | electron-main, 全部功能 |
| integration-test | AC1-AC17 | 全部 |

## Non-Goals

- 云端任务委派（第二阶段 B）。
- 多项目并行工作台（第二阶段 B）。
- 团队协作。
- 完整 IDE。
- 可交互终端。
- 自建权限审批系统。
- Trellis 写入 / 创建 / 归档。
- 插件市场。
- session tree 可视化。
- 系统托盘 / 全局快捷键。
- macOS / Linux 打包（后续适配）。

## Key References

- `docs/architecture.md` — 完整系统架构、ADR 决策记录。
- `docs/frontend-design.md` — 前端技术栈、风格、动效、Skill 纪律。
- `.trellis/spec/frontend/` — 前端编码规范（7 个文件）。
- `.trellis/spec/backend/` — 后端编码规范（6 个文件）。
- `.trellis/spec/guides/` — 跨层思维指南。
