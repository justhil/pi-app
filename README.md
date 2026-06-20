# pi Desktop

面向个人开发者的 **pi 桌面 GUI**：在 Electron 里跑 pi SDK，复用 `~/.pi/agent` 的认证、配置与会话 JSONL，用时间线、工具卡片、改动审查和扩展兼容层替代终端 TUI 的日常操作。

> 定位：pi 的新壳，不是另一个通用聊天客户端。会话与执行历史的**事实来源**仍是 pi 的 session 文件，桌面端只做展示、编排与 TUI 能力桥接。

---

## 环境要求

| 项 | 说明 |
|---|---|
| Node.js | **18+**（推荐 20+） |
| npm | 与仓库 `package-lock.json` 一致 |
| Electron | **35+**（依赖 pi 传递的 undici / Node 22 能力） |
| 系统 | **Windows 10+** 为主验证环境；macOS / Linux 可构建，未作为一等目标 |

pi 侧需已配置认证（`~/.pi/agent/auth.json` 或各厂商环境变量）。扩展与包与终端 pi 共用同一份 `settings.json`；部分 git 安装的包若未写入 `packages`，可在设置 → 扩展中同步进 `settings.packages` 并重启 Worker。

---

## 快速开始

```bash
git clone https://github.com/justhil/pi-app.git
cd pi-app
npm install
npm run dev
```

首次使用：

1. **打开磁盘项目**：侧栏「打开项目」选择工作目录；或 **对话分区** 新建临时沙箱（`userData/sandbox-workspaces/`，与真实仓库隔离）。
2. **选会话 / 新建**：项目下会话列表；`+` 新建会话；支持重命名、删除（磁盘项目会改 session JSONL / 元数据）。
3. **对话**：底部 Composer 输入；`/` 斜杠命令（内置 + pi 扩展）；流式过程中可 **排队 follow-up**；支持拖拽/选择文件、粘贴图片。
4. **右栏**：Review（本轮/本对话/Git）、Run、Context、Intercom、Trellis（只读）、**Tree**（会话树跳转，对齐 pi `/tree`）。

开发时若界面异常，可清 Vite 缓存后重试：`rm -rf node_modules/.vite && npm run dev`。

---

## 主要能力

### 工作区与会话

- 单活动 **cwd**（磁盘路径或沙箱路径），最近项目列表，启动可恢复上次项目。
- 会话列表来自 pi `SessionManager`；历史消息 **尾部分页** 加载，切换会话时优先快显 Timeline，完整 `AgentSession` 绑定可在首条发送或树跳转时完成。
- **会话树**：右栏 Tree / 双击 Esc 浮层；节点跳转调用 pi `navigateTree`；用户节点可把原文预填到 Composer。

### 对话与执行

- Worker 内 `createAgentSession` + 事件归一为 **AppEvent** 驱动 Timeline / Run。
- 工具调用：原生 read/edit/bash/grep 等结构化预览（diff、Shiki）；扩展工具走 **v2 `adapter.json`** 模板卡片与交互桥（问卷、图片审查等）。
- 模型 / 思考等级：Composer 内选择；设置 → Pi 可写回 `settings.json`（默认模型、压缩、重试等）。

### 设置（应用内）

| 页面 | 作用 |
|------|------|
| 常规 / 外观 | 启动、主题、密度 |
| Pi | 全局 pi 设置、可搜索默认模型 |
| 扩展 | 探测结果、Worker 实际工具列表、`packages` 同步 |
| 桌面适配器 | 每插件一条 v2 适配声明与配置 |
| Skills | 启用/禁用（写入 `settings.json` 的 `desktopSkillOverrides`） |
| 提示词 | 分组：项目上下文、pi 内置、模板、插件注入；可编辑与版本回退 |

已移除「资源」「诊断」独立页；MCP/主题等仍在扩展与适配器流程中体现。

### 扩展兼容层（B 层）

- 内置 `src/extension-compat/builtin/*.adapter.json`，用户可覆盖 `~/.pi/desktop/adapters/*.json`（仅 JSON）。
- 扩展的 `ctx.ui.*` 经 Worker **desktop-ui-bridge** 映射到 Electron 对话框/卡片；不修改各 npm 扩展源码。
- 详见 `docs/adapter-layer-plan.md`、`docs/compatibility-matrix-and-roadmap.md`、`docs/tui-replacement-and-adapters.md`。

---

## 架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React + Vite)                                     │
│  Timeline · Composer · Settings · 右栏面板 · Extension UI Host │
└────────────────────────────┬────────────────────────────────┘
                             │ preload 白名单 IPC
┌────────────────────────────┴────────────────────────────────┐
│  Main                                                         │
│  窗口 · ipc 契约 · configStore · Worker 生命周期 · 沙箱/资源 IO   │
└────────────────────────────┬────────────────────────────────┘
                             │ utilityProcess.postMessage
┌────────────────────────────┴────────────────────────────────┐
│  Pi Worker (ESM)                                              │
│  AgentSession · SessionManager · bindExtensions(uiContext)    │
└─────────────────────────────────────────────────────────────┘
```

- **安全**：`contextIsolation` + 精简 preload；Renderer 无 Node。
- **存储**：会话 = `~/.pi/agent/sessions/`；应用配置 = electron-store；可选 SQLite 索引；Skills/提示词修订 = `~/.pi/agent/desktop-revisions/`。

更完整说明见 [`docs/architecture.md`](docs/architecture.md)。

---

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（electron-vite） |
| `npm run build` | 构建 main / preload / renderer |
| `npm run typecheck` | TypeScript 检查 |
| `npm run icon:export` | 从 `resources/icon.svg` 生成 `build/icon.png` |
| `npm run package:win` | Windows NSIS 安装包（需先 icon） |
| `npm run package` | 当前平台打包 |

---

## 技术栈

- **Electron 35** · **electron-vite** · **React 18** · **TypeScript**
- **Tailwind** · **shadcn/Radix** · **Zustand** · **TanStack Query**
- **i18next**（中文为主）· **react-markdown** · **Shiki**（工具输出高亮）
- **@earendil-works/pi-coding-agent** ^0.79
- **electron-store** · **better-sqlite3** · **electron-updater**

UI 规范：[`docs/frontend-design.md`](docs/frontend-design.md)、[`.trellis/spec/frontend/`](.trellis/spec/frontend/)、[`docs/ui-design-notes.md`](docs/ui-design-notes.md)。

---

## 仓库与文档

| 路径 | 内容 |
|------|------|
| `packages/shared/` | IPC 契约、AppEvent、Zod schema |
| `src/main/` | Electron 主进程、IPC、沙箱、Trellis 只读、资源编辑 |
| `src/worker/` | pi SDK 集成与 UI 桥 |
| `src/extension-compat/` | 适配器加载、探测、builtin JSON |
| `src/renderer/` | React 应用 |
| `docs/` | 架构、前端、适配层、兼容矩阵 |

---

## 许可证

MIT