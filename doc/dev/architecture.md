# pi Desktop 架构

> 与 [README](../README.md) 互补：本文偏**结构与数据流**；产品能力见 README。

## 一句话

**Electron 壳 + React UI**，通过 **Main 进程 IPC** 驱动 **单 Worker 上的 pi SDK**，会话与配置以 **`~/.pi/agent` JSONL / settings** 为事实来源；扩展 TUI 经 **兼容层 + adapter.json** 转为桌面 UI。

---

## Context（系统边界）

```text
                    ┌─────────────────┐
                    │  用户 / 开发者   │
                    └────────┬────────┘
                             │
┌────────────────────────────┼────────────────────────────┐
│  pi Desktop (本应用)        │                            │
│  ┌──────────┐  IPC   ┌──────┴──────┐  MessageChannel   │
│  │ Renderer │◄──────►│ Main        │◄────────────────►│
│  │ (React)  │ events │             │      Worker       │
│  └──────────┘        └──────┬──────┘      (pi SDK)    │
└─────────────────────────────┼──────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  ~/.pi/agent          npm 全局/内置           项目 .pi/
  sessions, auth,      pi-coding-agent         skills, prompts
  settings, packages   (可切换 SDK)            AGENTS.md…
        │                     │
        ▼                     ▼
  扩展 npm 包            LLM Provider APIs
  (不改包内代码)
```

---

## Container（进程与模块）

```text
┌─────────────────────────────────────────────────────────────────┐
│ Renderer (src/renderer)                                           │
│  app shell · Timeline · Composer · Settings · ExtensionUIHost     │
│  Zustand (UI) + AppEvent 流 + ipcClient.invoke                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ preload: contextBridge 白名单
┌────────────────────────────┴────────────────────────────────────┐
│ Main (src/main)                                                 │
│  index · ipc.ts (registerHandler) · worker-manager              │
│  config-store · sandbox · session-tree-from-file · sdk-loader   │
│  extension-compat 配置后端 · side-panel-registry(原语) · updater  │
└────────────────────────────┬────────────────────────────────────┘
                             │ utilityProcess.fork(worker.mjs)
┌────────────────────────────┴────────────────────────────────────┐
│ Worker (src/worker)                                             │
│  动态 import 生效 SDK · createAgentSession · ResourceLoader      │
│  desktop-ui-bridge → Extension UI RPC → Main → Renderer         │
│  AppEvent normalizer → ipc:events                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────┐
│ pi SDK (@earendil-works/pi-coding-agent)                        │
│  SessionManager · tools · extensions · MCP · skills             │
└─────────────────────────────────────────────────────────────────┘

旁路：src/extension-compat — adapter.json 加载、通用 adapter.* IPC（详见 [adapter-layer-plan.md](../doc/adapter-layer-plan.md)）
```

**硬约束（摘自 `.trellis/spec`）**

| 规则 | 含义 |
|------|------|
| Renderer 不直接 import Node / pi SDK | 必须 IPC + Worker |
| Worker 不渲染 UI | 只产出 AppEvent / UI 请求 |
| 会话正文不存 App DB | JSONL 为事实来源 |
| App 本体零插件名分支 | 扩展走 `adapter.json` + 原语 |
| 多 Worker 进程池 | 一 session 一 worker；切 cwd 不重启，按 sessionKey acquire/release；见 [multi-pane-parallel.md](./multi-pane-parallel.md) |

---

## 关键数据流

### 1. 发送消息 → 时间线更新

1. Renderer `prompt.send` / `sendWithImages` → Main `ipc.ts`
2. Main `workerManager.request(...)` → Worker `prompt` 分支
3. Worker `session.prompt` / 流式事件 → normalizer → `AppEvent`
4. Main `sendEvent` → Renderer `ipc:events` → `ui-store.processEvent`
5. Timeline 渲染 message / tool / run 相位

### 2. 扩展弹窗（必答）

1. 扩展调用 ExtensionUIContext → Worker `desktop-ui-bridge`
2. Worker `extensionUIRequest` → Main 转发 → Renderer `ExtensionUIHost`
3. 用户选择 → `extension.respondUI` → Worker 恢复 pending Promise
4. 对话继续（阻塞在 Worker 侧直至响应）

### 3. SDK 切换（内置 / 全局 / 独立环境）

1. Renderer `sdk.install` / `sdk.switch` → `sdk-manager`
2. 写 `userData/sdk/current.json`；`npm install -g` 或 `userData/sdk/current/` 安装
3. `workerManager.stop` + `start(cwd)`；init 带 `sdkPath`
4. Worker 动态 `import(entryPath)`；失败回退内置并 `sdkFallback`

### 4. 会话列表（Worker 未就绪时）

- Main `session.list` 可走 `SessionManager`（经 `resolveActiveSdk`）扫磁盘 JSONL，与 Worker 内列表需保持一致语义。

---

## 数据与存储

| 数据 | 位置 | 所有者 |
|------|------|--------|
| 对话、工具记录 | `~/.pi/agent/sessions/*.jsonl` | pi SDK |
| 认证、全局 settings、packages | `~/.pi/agent/` | pi SDK / 设置写回 |
| 应用偏好、侧栏宽度、右栏 Tab | electron-store (`config-store`) | Main |
| SDK 生效模式 | `userData/sdk/current.json` | sdk-manager |
| 独立环境 SDK 依赖树 | `userData/sdk/current/node_modules/...` | npm local install |
| 沙箱 cwd | `userData/sandbox-workspaces/` | Main |
| 适配器 JSON 覆盖 | `~/.pi/desktop/adapters/`、`.pi/desktop/adapters/` | 用户 |
| 资源编辑修订 | `~/.pi/agent/desktop-revisions/` | Main |
| SQLite 索引 | 规划/部分实现 | App（非聊天正文） |

---

## IPC 与事件契约

- **请求/响应**：`packages/shared/ipc-contract.ts`（类型）；Main `registerHandler('ipc:…')`；Renderer `ipcClient.invoke`。
- **实时流**：`packages/shared/app-events.ts`（message / tool / file / run / compaction / slash / queue / sdk-install-progress 等）。
- **扩展**：`adapter.config.*`、`adapter.action.run`、`extension.respondUI` 等通用通道，避免每插件一条 channel。

---

## 前端壳层（当前实现要点）

- 三栏 Grid + 侧栏 `0fr` 动画；中间列 `MainColumnWithTimelineScroll` 转发滚轮到 Timeline。
- **悬浮 Composer** + 底部 `padding-bottom` / `scroll-padding-bottom`（`--composer-dock-h`）。
- 自绘滚动条（`OverlayScrollHost`）、聊天进度条（`ChatTimelineProgressRail`）与输入区 z-index / 渐变裁切协调。
- 右栏 Tab 可配置（`rightPanelPrefs` + `packages/shared/right-panels.ts`）。

---

## 构建与产物

- **electron-vite**：`main` / `preload` / `renderer` / `worker`；pi-coding-agent **external**，运行时从内置或全局/用户路径加载。
- **打包**：`electron-builder`，`app.asar` 内只读内置 SDK；升级不修改 asar。

---

## 相关目录速查

```text
packages/shared/     IPC 类型、AppEvent、right-panels、schemas
src/main/            ipc.ts, worker-manager.ts, sdk-*, config-store
src/worker/          index.ts, desktop-ui-bridge.ts
src/extension-compat/  adapter.json 内置与加载
src/renderer/        features/*, stores/ui-store.ts
.trellis/spec/       前后端实现硬约束
```