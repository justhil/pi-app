# pi Desktop

面向个人开发者的 **pi 桌面 GUI**：在 Electron 里跑 pi SDK，复用 `~/.pi/agent` 的认证、配置与会话 JSONL，用时间线、工具卡片、改动审查和**扩展兼容层**替代终端里那套 TUI 交互。

> **一句话**：pi 的新壳——内核仍是 pi，界面换成桌面；扩展在终端里的弹窗和卡片，由兼容层翻译成窗口 UI，**不改你已安装的扩展包**。

---

## 核心思想

### 1. 会话以 pi 为准

- 对话内容、工具调用记录、分支与压缩信息，都以 pi 写在 `~/.pi/agent/sessions/` 里的 **JSONL 会话文件**为准。
- 桌面端不另建一套「聊天记录数据库」来替代 pi；本地只存窗口布局、最近项目、扩展开关、适配器覆盖等**应用偏好**。
- 好处：终端 pi 与桌面 pi 可以**接着同一条会话**用；卸载桌面也不丢对话历史。

### 2. 配置与认证与终端共用

- 模型账号、`settings.json`、扩展包列表（`packages`）、项目下 `.pi/` 资源，与你在终端用的 pi **同一套路径与规则**。
- 桌面在 **设置 → Pi** 里改的项会写回全局 `settings.json`（与终端一致）；Skills 开关等也落在全局配置里，而不是只在桌面私有文件里「假启用」。

### 3. 扩展：兼容层 + 适配器，而不是改插件源码

- 扩展在终端里常用 TUI（选择、确认、问卷、工具结果卡片、`/命令` 进配置）。桌面没有终端画布。
- **兼容层**：在应用内部统一接收扩展的 UI 请求，转成 Electron 对话框、时间线卡片、设置表单。
- **适配器**：每个扩展一份「在桌面上怎么显示、怎么配、哪些命令特殊处理」的说明（内置在应用里，高级用户可用 JSON 覆盖）。
- 原则：**不动扩展 npm 包、不 fork pi**；差异写在适配器说明和文档里。  
- **给 AI 写适配器**：见仓库 **[`doc/`](./doc/README.md)**（`adapter-authoring-guide.md` 可整份发给模型定制 `adapter.json`）。

---

## 环境要求

| 项 | 说明 |
|---|---|
| Node.js | **18+**（推荐 20+） |
| npm | 与仓库 `package-lock.json` 一致 |
| Electron | **35+** |
| 系统 | **Windows 10+** 为主验证环境；macOS / Linux 可构建 |

pi 侧需已配置认证（`~/.pi/agent/auth.json` 或各厂商环境变量）。扩展与终端 pi 共用 `~/.pi/agent/settings.json`；若终端能用的扩展在桌面工具列表里没有，见 **设置 → 扩展** 同步 `packages` 并重启后台会话。

---

## 快速开始

```bash
git clone https://github.com/justhil/pi-app.git
cd pi-app
npm install
npm run dev
```

**首次使用**

1. **磁盘项目**：侧栏「打开项目」选工作目录。  
2. **临时对话**：「对话分区」新建沙箱（与真实仓库隔离，工具 cwd 在应用用户数据目录下）。  
3. **会话**：列表中选历史会话或 `+` 新建；右键可重命名/删除（磁盘项目会改 pi 会话文件）。  
4. **输入区**：回车发送；`/` 斜杠命令；运行中可继续发（排队跟进）；拖入文件或 `+` 选附件；可粘贴图片。  
5. **右栏**：改动审查、运行状态、上下文、**会话树**（等同 pi `/tree` 式跳转）。空白输入时 **双击 Esc** 可打开会话树浮层。

**常见问题**

| 现象 | 建议 |
|------|------|
| 白屏 / 界面不更新 | 删 `node_modules/.vite` 后 `npm run dev` |
| 扩展在设置里能看到，对话里没有工具 | 设置 → 扩展：确认已写入 `packages` 并重启会话；看「当前已加载工具」列表 |
| 切换会话慢 | 先加载最近一段历史；发第一条消息后再完整绑定会话（设计如此） |

打包 Windows：`npm run icon:export && npm run package:win`。

---

## 键盘快捷键与基本操作

| 操作 | 快捷键 / 方式 | 说明 |
|------|-------------|------|
| **发送消息** | `Enter` | 发送当前输入框内容；`Shift+Enter` 换行 |
| **停止生成** | `Esc`（单次） | Agent 运行中按一下 Esc 中止当前轮次 |
| **会话树 / 回退** | `Esc Esc`（双击） | 输入框为空时双击 Esc 打开会话树浮层，可跳转到任意历史节点 |
| **斜杠命令** | `/` | 输入 `/` 触发命令补全（扩展命令、`/new`、`/tree` 等） |
| **附加文件** | 拖拽到输入框 | 从文件管理器拖入文件自动附加为引用；也可点 `+` 按钮选择 |
| **粘贴图片** | `Ctrl+V` | 剪贴板有图片时粘贴到输入框，自动转为 multimodal 输入 |
| **排队跟进** | 运行中继续输入 | Agent 运行时发送的消息排队，当前轮次结束后自动跟进 |
| **消息回退** | 悬停消息 → Undo 图标 | 时间线消息悬停出现回退按钮，点击跳转到该消息节点 |
| **复制消息** | 悬停消息 → Copy 图标 | 复制消息纯文本到剪贴板 |
| **模型切换** | 输入区底部 pill | 点击模型名切换当前会话模型 |
| **思考等级** | 输入区底部 pill | 点击切换 thinking level |
| **侧栏开关** | 顶栏左侧图标 | 折叠 / 展开左侧项目栏 |
| **右栏开关** | 顶栏右侧图标 | 折叠 / 展开右侧面板栏 |
| **侧栏拖拽调宽** | 拖动列分界线 | 左栏右缘、右栏左缘可拖动调整宽度 |
| **会话右键菜单** | 右键会话条目 | 重命名 / 删除会话 |
| **扩展弹窗** | 自动弹出 | 扩展请求选择/确认/问卷时自动弹窗；可点「稍后作答」挂起，时间线可「继续作答」 |

**对话中的错误展示**：模型/API 失败、上游 `empty_stream`、自动重试耗尽（如 `Aborted after 1 retry attempt`）、用户中止（`Request was aborted`）等，会在时间线插入红色/琥珀色 **运行出错** 卡片，并显示整理后的完整报错（含 JSON 内的 `server_error` 文案）。右栏 **Run** 状态会标为失败；发送失败仍会 toast「发送失败」。

---

## 界面结构（你在用什么）

```text
┌──────────────────────────────────────────────────────────────────┐
│ 顶栏（沉浸模式）：侧栏开关 · 项目/会话标题 · 运行状态 · 窗口按钮     │
├────────────┬─────────────────────────────────────┬───────────────┤
│ 左栏       │ 中间：时间线（上）+ 浮动输入区（下）    │ 右栏（可收起） │
│            │                                     │               │
│ 磁盘项目树 │ 用户 / 助手 / 工具行 / 思考链        │ 审查·运行·    │
│ 会话列表   │                                     │ 上下文·树…    │
│ 对话分区   │                                     │               │
└────────────┴─────────────────────────────────────┴───────────────┘
```

- **设置**（独立全屏页）：常规、外观、Pi、扩展、**桌面适配器**、Skills、提示词。

---

## 主要能力

### 工作区与会话

- 单活动 cwd（磁盘路径或沙箱）；最近项目；启动可恢复上次目录。
- 历史消息**从尾部按需加载**；切换会话先显示最近一段，完整会话在发送或树跳转时再绑定。
- **会话树**：右栏或双击 Esc 浮层；节点跳转回到该分支；用户消息节点可把原文填回输入框。有 git 仓库时 pi-rewind 扩展会询问是否同时回退文件。

### 对话与执行

- 时间线：流式 Markdown、工具折叠行、原生工具的 diff/高亮预览。
- 扩展工具：展示与弹窗由**兼容层 + 适配器**决定（下一节）。
- 模型 / 思考等级在输入区切换；全局 pi 参数在 **设置 → Pi**。

### 设置一览

| 页面 | 作用 |
|------|------|
| 常规 / 外观 | 启动、主题 |
| Pi | 默认模型、压缩、重试等（写回 `settings.json`） |
| 扩展 | 已探测扩展、当前会话实际加载的工具 |
| **桌面适配器** | 每扩展的兼容说明、配置表单 |
| Skills | 启用/禁用（`desktopSkillOverrides`） |
| 提示词 | 项目上下文 / pi 内置 / 模板 / 插件注入；编辑与版本回退 |

---

## 扩展兼容层与适配器

很多 pi **扩展**依赖终端 TUI。若每个扩展各写一套桌面 UI，应用会难以维护。

**兼容层**负责：

- 在后台 pi 会话与前台窗口之间转发：**工具进度与结果**、**扩展弹窗**（选择/确认/问卷/审图等）、**配置读写**（仍尽量写扩展自己的配置文件）。
- **不修改**扩展安装目录里的代码，**不修改** pi SDK 源码。

**适配器**（每个扩展一份）说明：

| 内容 | 用户可见位置 |
|------|----------------|
| 配置项与读写位置 | 设置 → 桌面适配器 → 该扩展 |
| 工具结果如何展示 | 时间线工具行（列表、预览、导出链接等） |
| 需要中途互动的工具 | 对话中弹窗，点选后对话继续 |
| 部分 `/命令` | 打开配置页、提示，或按 pi 原逻辑执行 |

内置适配随应用发布；可在 `~/.pi/desktop/adapters/` 或项目 `.pi/desktop/adapters/` 放 JSON 覆盖（高级）。

### 内置适配器列表

以下适配器已内置在应用中（对应扩展需在 `~/.pi/agent/settings.json` 的 `packages` 中安装才生效）：

| 适配器 | 扩展包 | 链接 | 说明 |
|--------|--------|------|------|
| Trellis | `trellis` | [GitHub](https://github.com/trentbrew/trellis) | 项目任务面板（只读 sidePanel，读取 `.trellis/`） |
| pi-rewind | `pi-rewind` | [GitHub](https://github.com/arpagon/pi-rewind) | Git 检查点回退；会话树跳转时询问是否恢复文件 |
| Ask User Question | `@juicesharp/rpiv-ask-user-question` | [GitHub](https://github.com/juicesharp/rpiv-mono) | 结构化问答弹窗 |
| Image Gen | `pi-image-gen` | [GitHub](https://github.com/jvm/pi-mono) | 图片生成 / 审查弹窗 |
| Multimodal Vision | `pi-multimodal-proxy` | [GitHub](https://github.com/pungggi/pi-vision-proxy) | 多模态视觉代理 |
| Markdown Preview | `pi-markdown-preview` | [GitHub](https://github.com/omaclaren/pi-markdown-preview) | Markdown 实时预览卡片 |
| Studio | `pi-studio` | [GitHub](https://github.com/omaclaren/pi-studio) | Studio REPL 集成 |
| Fast Context | `pi-fast-context` | [GitHub](https://github.com/MattDevy/pi-extensions) | 快速上下文检索 |
| Subagents | `pi-subagents` | [GitHub](https://github.com/nicobailon/pi-subagents) | 子 Agent 派发与管理 |
| Cache Optimizer | `pi-cache-optimizer` | [GitHub](https://github.com/jiangge/pi-cache-optimizer) | 缓存优化配置 |
| Skills Manager | `@vanillagreen/pi-skills-manager` | [GitHub](https://github.com/vanillagreencom/vstack) | Skills 管理配置 UI |
| MCP Adapter | `pi-mcp-adapter` | [GitHub](https://github.com/nicobailon/pi-mcp-adapter) | MCP 服务器适配 |
| Context Viewer | `@agnishc/edb-context-viewer` | [GitHub](https://github.com/agnishcc/pi-extention-monorepo) | 上下文查看器 |
| FFF | `@ff-labs/pi-fff` | [GitHub](https://github.com/dmtrKovalenko/fff) |uzzy 文件查找 |
| Sync | `@narumitw/pi-sync` | [GitHub](https://github.com/narumiruna/pi-extensions) | 会话同步配置 |
| Continue | `pi-continue` | [GitHub](https://github.com/Tiziano-AI/pi-continue) | 继续对话配置 |
| Goal | `pi-goal` | [GitHub](https://github.com/jvm/pi-mono) | 目标管理 |
| BTW | `pi-btw` | [GitHub](https://github.com/dbachelder/pi-btw) | 旁注记录 |
| Simplify | `pi-simplify` | [GitHub](https://github.com/MattDevy/pi-extensions) | 代码简化建议 |
| Advisor | `@juicesharp/rpiv-advisor` | [GitHub](https://github.com/juicesharp/rpiv-mono) | 顾问建议弹窗 |
| Observational Memory | `pi-observational-memory` | [GitHub](https://github.com/elpapi42/pi-observational-memory) | 观察记忆配置 |
| Tool Display | `pi-tool-display` | [GitHub](https://github.com/MasuRii/pi-tool-display) | 工具展示卡片 |
| Agents.md | `pi-agentsmd` | [GitHub](https://github.com/jvm/pi-mono) | AGENTS.md 管理配置 |
| ACE Tool | `pi-ace-tool` | [npm](https://www.npmjs.com/package/pi-ace-tool) | ACE 工具集成 |
| Sequential Thinking | `@feniix/pi-sequential-thinking` | [GitHub](https://github.com/feniix/pi-extensions) | 顺序思考配置 |
| Aegis | `aegis` | [GitHub](https://github.com/killdream/aegis) | Aegis 工作流引擎 |
| TPS Extensions | `@kinarajv/pi-tps-extensions` | [GitHub](https://github.com/kinarajv/pi-tps-extensions) | TPS 扩展配置 |
| Nano Context | `pi-nano-context` | [GitHub](https://github.com/daynin/nano-context) | 纳米上下文 |
| Powerline Footer | `pi-powerline-footer` | [GitHub](https://github.com/nicobailon/pi-powerline-footer) | 底栏状态行 |
| Amp Themes | `amp-themes` | [npm](https://www.npmjs.com/package/amp-themes) | Amp 主题 |
| Curated Themes | `@victor-software-house/pi-curated-themes` | [GitHub](https://github.com/victor-software-house/pi-curated-themes) | 精选主题 |
| Themes Bundle | `@firstpick/pi-themes-bundle` | [GitHub](https://github.com/Firstp1ck/npm-packages) | 主题合集 |
| Pi Search | `pi-search` | [GitHub](https://github.com/MattDevy/pi-extensions) | 搜索工具 |

**与终端 pi**

| 能力 | 终端 pi | pi Desktop |
|------|---------|------------|
| 对话与 session | TUI | 图形时间线 + 输入区 |
| 扩展弹窗 | 终端组件 | 兼容层 → 窗口 |
| 扩展配置 | TUI / 文件 | 设置 → 适配器（仍写扩展常用配置文件） |
| Skills / 提示词 | 目录 + settings | 设置集中管理 + 本地修订历史 |

## 架构概览

```text
┌─────────────────────────────────────────────────────────────┐
│  界面 (React) — 时间线、输入区、设置、扩展弹窗宿主              │
└────────────────────────────┬────────────────────────────────┘
                             │ preload 白名单 IPC
┌────────────────────────────┴────────────────────────────────┐
│  主进程 — 窗口、应用配置、沙箱/文件、适配器配置后端、会话树文件解析  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│  Pi 后台进程 — pi SDK、加载扩展、事件与 UI 请求                  │
└─────────────────────────────────────────────────────────────┘
```

**数据落点**

| 数据 | 位置 |
|------|------|
| 会话与运行历史 | `~/.pi/agent/sessions/`（pi JSONL） |
| 认证与全局 pi 设置 | `~/.pi/agent/` |
| 应用偏好（主题、侧栏宽度等） | 本机 electron-store |
| 提示词/技能编辑快照 | `~/.pi/agent/desktop-revisions/` |
| 临时对话沙箱 | 应用 `userData/sandbox-workspaces/` |

## 目录结构

```text
pi-app/
├── README.md
├── package.json
├── electron.vite.config.ts      # main / preload / renderer / worker 构建
├── electron-builder.yml           # 安装包
├── resources/
│   └── icon.svg                   # 应用图标源（npm run icon:export → build/icon.png）
│
├── packages/
│   └── shared/                    # IPC 方法名、AppEvent、Zod 校验（前后端共用）
│
├── src/
│   ├── main/                      # Electron 主进程
│   │   ├── index.ts               # 入口、窗口、自动打开上次项目
│   │   ├── ipc.ts                 # ipc:* 处理函数
│   │   ├── worker-manager.ts      # Pi 后台进程生命周期与请求
│   │   ├── config-store.ts        # 应用本地配置
│   │   ├── sandbox-workspaces.ts  # 对话分区沙箱
│   │   ├── session-tree-from-file.ts  # 未绑定会话时从 JSONL 读树
│   │   ├── pi-resources-editor.ts # Skills/提示词磁盘读写
│   │   ├── resource-revisions.ts  # 编辑版本回退
│   │   ├── workspace-task-panel-reader.ts  # 右栏原语 workspace-trellis
│   │   ├── side-panel-registry.ts   # adapter sidePanel.stateProvider
│   │   └── …
│   │
│   ├── preload/                   # contextBridge 暴露给界面的安全 API
│   │
│   ├── worker/                    # Pi 后台进程（utilityProcess）
│   │   ├── index.ts               # createAgentSession、消息处理
│   │   └── desktop-ui-bridge.ts   # 扩展 ctx.ui → 发给界面
│   │
│   ├── extension-compat/          # ★ 扩展兼容层
│   │   ├── builtin/*.adapter.json # 各扩展内置适配描述
│   │   ├── adapter-loader.ts      # 合并内置与用户覆盖
│   │   ├── adapter-backend.ts     # 配置读写、探测、通用动作
│   │   ├── extension-probe.ts     # 扫描已安装扩展
│   │   └── …
│   │
│   └── renderer/                  # React 界面
│       ├── index.html
│       └── src/
│           ├── app/               # 壳层、三栏布局
│           ├── features/          # 按功能划分
│           │   ├── timeline/      # 时间线、Markdown、工具预览
│           │   ├── composer/      # 输入区、斜杠、模型选择
│           │   ├── review/        # 改动审查
│           │   ├── run/ context/ trellis/ rewind/
│           │   ├── settings/      # 设置各页
│           │   ├── extension-ui/  # 扩展弹窗、适配器配置表单
│           │   └── workspace/     # 侧栏项目与会话
│           ├── components/ui/     # shadcn 基础组件
│           ├── stores/            # Zustand（含持久化 UI 状态）
│           ├── lib/               # IPC 客户端、会话切换、历史分页
│           ├── locales/           # i18n
│           └── styles/            # globals.css、动效 token
│
└── scripts/                       # 图标导出等构建脚本
```

**改界面** → 优先 `src/renderer/src/features/`。  
**改 IPC 或沙箱/资源文件** → `src/main/` + `packages/shared/`。  
**改 pi 会话行为** → `src/worker/`。  
**新扩展桌面支持** → `src/extension-compat/builtin/` 增加适配 JSON。

---

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式 |
| `npm run build` | 构建 main / preload / renderer / worker |
| `npm run typecheck` | TypeScript 检查 |
| `npm run icon:export` | `resources/icon.svg` → `build/icon.png` |
| `npm run package:win` | Windows NSIS 安装包 + 便携版（`dist/`） |

**GitHub Release（CI）**

- 工作流：`.github/workflows/release.yml`
- 推送标签 `v*`（如 `v0.1.0`）或 Actions 里手动 **Run workflow**，在 Windows 上构建并上传：
  - `pi Desktop-Setup-<version>-x64.exe`（安装包）
  - `pi Desktop-Portable-<version>-x64.exe`（便携包）
- 打标签示例：`git tag v0.1.0 && git push origin v0.1.0`

---

## 技术栈

Electron 35 · electron-vite · React 18 · TypeScript · Tailwind · shadcn/Radix · Zustand · TanStack Query · i18next · react-markdown · Shiki · **@earendil-works/pi-coding-agent** ^0.79 · electron-store · better-sqlite3 · electron-updater

---

## 许可证

MIT

---

## 友链

- [LinuxDo](https://linux.do/) — 社区讨论与反馈