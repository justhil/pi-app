# pi Desktop

一个基于 [pi](https://github.com/earendil-works/pi-coding-agent) 的桌面端 AI Agent GUI。提供图形化界面来管理 pi 编码会话、查看工具执行、代码变更和运行状态。

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Windows 10+ (macOS/Linux 也支持但未重点测试)

### 安装

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

这会启动 Electron 开发服务器，应用窗口自动打开。

### 首次使用

1. **配置 pi 认证**：确保 `~/.pi/agent/auth.json` 已配置 API key，或设置环境变量如 `ANTHROPIC_API_KEY`
2. **打开项目**：点击左侧边栏「打开项目」选择工作目录
3. **开始对话**：在底部输入框输入消息，回车发送

## 功能

### 核心功能

- **项目管理**：打开/切换工作目录，自动恢复上次项目
- **会话管理**：列出历史会话，新建/继续会话
- **对话**：流式发送消息，查看 pi 的回复
- **工具执行**：以卡片形式展示 read/edit/bash/grep 等工具调用
- **中止/继续**：可中止运行中的任务
- **图片支持**：粘贴图片到对话

### 三大面板

- **Review**：代码变更视图，支持 Turn/Session/Git 三种范围
- **Trellis**：只读显示 Trellis 任务状态、阶段、验收条件
- **Run**：运行状态、耗时、Token 用量、费用统计

### 设置

- **常规**：启动行为、语言（中/英）、最近项目
- **外观**：主题切换（浅色/深色/跟随系统）
- **Pi**：SDK 版本、认证状态、配置路径
- **插件**：扩展兼容性管理
- **资源**：Skills/Prompts/Themes 列表
- **诊断**：系统状态检查

## 架构

```
┌─────────────────────────────────────────┐
│  Electron Renderer (React)              │
│  ┌─────────┬─────────────┬───────────┐  │
│  │Sidebar  │Timeline     │Right Panel│  │
│  │Sessions │+ Composer   │Review/Run │  │
│  │Settings │             │Trellis    │  │
│  └─────────┴─────────────┴───────────┘  │
└──────────────────┬──────────────────────┘
                   │ Typed IPC (preload bridge)
┌──────────────────┴──────────────────────┐
│  Electron Main Process                  │
│  - Window management                    │
│  - IPC broker                           │
│  - Worker lifecycle                     │
│  - Config store (electron-store)        │
│  - SQLite index                         │
└──────────────────┬──────────────────────┘
                   │ utilityProcess + MessageChannel
┌──────────────────┴──────────────────────┐
│  Pi Worker (utilityProcess)             │
│  - pi SDK AgentSession                  │
│  - Event normalization → AppEvent       │
│  - Prompt/abort/steer/followUp          │
└─────────────────────────────────────────┘
```

### 进程边界

- **Renderer**：纯 UI，无 Node.js 访问，通过 preload 白名单 API 通信
- **Main**：窗口管理、IPC 路由、配置存储，不直接执行 pi 工具
- **Worker**：运行 pi SDK，处理会话和工具执行，可独立重启

### 数据源

- **会话和运行记录**：pi session JSONL (`~/.pi/agent/sessions/`)
- **UI 状态、配置**：electron-store + SQLite index
- **认证**：复用 `~/.pi/agent/auth.json`

## 构建

```bash
# 构建
npm run build

# 打包 Windows 安装包
npm run package:win
```

## 技术栈

- **Electron 35** + **electron-vite**
- **React 18** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (zinc base)
- **Zustand** (状态管理)
- **i18next** (国际化)
- **@earendil-works/pi-coding-agent** (pi SDK)
- **electron-store** + **better-sqlite3** (存储)

## 许可证

MIT
