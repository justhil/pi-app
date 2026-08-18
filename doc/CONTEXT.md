# pi-app 架构上下文（审计 / 重构用）

### 决策记录：侧栏项目固定顺序（2026）

侧栏项目列表默认按最近使用（MRU）排序：打开项目时 `configStore.addRecentProject` 把项目移到最前，且当前工作区始终置顶（`project-sidebar.tsx` 的 `diskPaths`）。新增配置项 `recentProjectsFixedOrder`（默认 `false`，保持 MRU 行为）：开启后 `nextRecentProjects` 不再移动已有项目（新项目追加到末尾），侧栏按存储顺序展示且当前项目不置顶（仅高亮）。纯函数：`src/main/recent-projects.ts`、`src/renderer/src/features/workspace/project-folder-order.ts`。设置页「最近项目」区开关直接写配置并派发 `pi-desktop:settings-changed` 事件通知侧栏即时重排。

**闪烁根因（勿回退）**：`ui-store.setWorkspace` 曾把当前工作区 unshift 到 `recentProjects` 最前——固定模式下侧栏先跳顶，随后 `reloadSidebarSettings` 从主进程拉回真实顺序——先跳再弹回 = 每次切换可见闪烁。修复：`setWorkspace` 不再重排 `recentProjects`（侧栏顺序以主进程配置为唯一事实源；MRU 模式由 `projectFolderOrder` 的“当前置顶”规则兜底即时显示）。另：`reloadSidebarSettings` 在顺序无变化时保持数组引用稳定，避免固定模式下每次切换都触发整个侧栏重渲染。
## 会话树交互术语（glossary）

- **查看跳转（view-jump）**：单击会话树节点，时间线非破坏性定位到该节点对应的消息。历史未加载时先触发只读补拉，加载完成后再跳转；不改变会话叶子、不回退、不打断用户输入。
- **回退（rewind）**：双击会话树节点或使用回退按钮，将会话当前位置移动到该节点（改变叶子，可再回退恢复）。
- **全局统一**：右栏会话树面板与双击 Esc 的会话树浮层交互一致：单击或 Enter=查看跳转，双击=回退。

### 决策记录：单击=查看、双击=回退（2026）

会话树曾两次被改错：`a34ffa2` 把单击改成仅选中（“点击没反应”），后续提交又把单击改成直接回退（破坏性）。正确语义：**单击/Enter=非破坏性查看跳转**（时间线定位到该节点，不改叶子、不打扰输入；未加载的历史只读补拉并增量合并，时间线始终代表真实最新）；**双击=回退**（navigateTree）。勿再改为“单击=回退”。

## 进程边界

| 进程 | 目录 | 职责 |
|------|------|------|
| Main | `src/main/` | 窗口、IPC、`config-store`、Worker 生命周期、sandbox 工作区 |
| Preload | `src/preload/` | `contextBridge` → `piDesktop`；`invoke` 仅允许 `packages/shared/ipc-channels.ts` |
| Renderer | `src/renderer/src/` | React UI；全局状态 `stores/ui-store.ts` |
| Worker | `src/worker/` | Pi SDK 会话；经 Main 桥接 |

## IPC 接缝（单一注册表）

- `src/main/ipc/registry.ts` — `registerHandler` / `sendEvent`
- `src/main/ipc.ts` — `registerAllHandlers()` 引导；逐步迁出内联 `registerHandler`
- `src/main/ipc/handlers/*` — 按域：`dialog`, `workspace`, `workspace-fs`, `session`, `prompt`, `settings`, …
- 契约列表：`packages/shared/ipc-channels.ts`（与 Main 注册必须同步，见 `scripts/tests/ipc-channel-sync.test.mjs`）

## 事件流

Renderer `piDesktop.onEvent` ← Main `sendEvent(win, AppEvent)` ← Worker。

- 类型：`packages/shared/app-events.ts`
- 会话守卫：`packages/shared/app-event-session.ts`
- 归约：`src/renderer/src/stores/apply-app-event.ts`（`ui-store` 调用，勿再把大段 switch 塞回 store）

## 安全默认值

- `src/main/window.ts`：`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 默认（`PI_RENDERER_SANDBOX=0` 可关；见 `doc/THREAT-MODEL.md`）
- Codex JWT：`src/main/secret-store.ts` + `asr-config-store.ts`（safeStorage，明文迁移）

## 质量门禁

- `npm run typecheck` — web + node
- `npm run test:scripts` — CI `quality.yml`
- `node scripts/ci-audit.mjs` — CI `dependency-audit`（critical 门禁）
- `doc/IPC-CONTRACTS.md` — IPC Backend-API 文档
- FMSM iter14 整改：**sandbox 默认 true**；`test:e2e`；CI `e2e-smoke` + `script-tests-win`；报告 `docs/audit/*iter14*`

## 严苛评分（FMSM 2026-07-01）

| 项 | 严苛分 | PRD 目标 |
|----|--------|----------|
| Overall | **8.0 A**（iter13：FMSM 整改 + PRD gates） | ≥8.0 ✓ |
| Testing | **7.4**（`scripts/tests` 29 文件，`fmsm-prd-gates` ≥27） | ≥7.0 ✓ |
| ipc **36**；ui-store **329**；apply-app-event **71**；worker/index **≤1100** 行；`as any` **≤22** | `worker-session-events` / `worker-timeline` / `worker-compaction-patch` 已拆 |

Trellis：`07-01-fmsm-remediate-a` 已归档 `archive/2026-07/`。威胁模型：`doc/THREAT-MODEL.md`（含 safeStorage）。

## 斜杠命令拦截术语（glossary，2026-08-18 访谈确认）

- **内置命令泄漏（builtin leak）**：pi 内置斜杠命令（如 `/reload`、`/export`、`/login`）被桌面端当作普通聊天文本发给模型——命令既不执行也无任何提示。根因：pi 内置命令只在 TUI 层拦截（`interactive-mode.js` 的 submit 链），SDK 层 `session.prompt()` 只处理扩展命令/skill/模板，内置命令会原样落到 LLM；桌面端不用 TUI，必须自己拦截。曾误以为 `/compact` 按钮已生效——它此前走 `runExtensionCommand('/compact')`，同样把文本发给了模型，属于同一种泄漏。
- **生效 SDK 内置清单（active-SDK builtin catalog）**：pi 内置命令清单的唯一事实源 = 生效 SDK 的 `dist/core/slash-commands.js`（`BUILTIN_SLASH_COMMANDS`，纯数据模块）。worker 新增 `getBuiltins` RPC 从当前 `activeSdkPath` 同目录导入（失败回退内置包），经 `ipc:commands.builtins` 同步到 renderer（`slash-catalog.ts` 缓存）——跟随用户装的 pi 版本（内置/全局/用户 SDK）自动更新，不维护硬编码行为表。
- **路由表 + 安全默认（routing table + safe default）**：内置命令行为按名字查路由表：有原生实现 → 执行；未实现 → 默认 toast 拦截（可带指向等效 UI 的提示，如 `/login`→设置、`/name`→右键重命名、`/quit`→窗口关闭按钮）；未知 `/xxx` → 透传模型（与 pi TUI 兜底行为一致）。效果：新 pi 内置出现时**自动落入默认拦截**（有 toast），永远不会再静默泄漏；后续想原生实现某个命令 = 路由表加一个 case。
- **桌面原生命令（desktop-native command）**：桌面端自己实现的斜杠命令（含 pi 没有的 `thinking/clear/help/review/run/skills/prompts`），与 pi 内置重叠时（`model/compact/new/fork/clone/tree/settings`）以桌面实现优先。

### 决策记录：内置命令统一走生效 SDK 清单 + 路由表 + 安全默认（2026）

`/reload` 在 pi-app 里被当作普通文本发给模型并得到 AI 回复——暴露一类系统性问题：pi 内置命令在 SDK 层不拦截，桌面端不维护硬编码清单就会漏。定案：**拦截集合 = 生效 SDK 的 `BUILTIN_SLASH_COMMANDS`（worker `getBuiltins` 动态导入，renderer `slash-catalog.ts` 缓存 + 兜底名集）∪ 桌面原生命令**；行为走 `slash-exec.ts` 路由表，未实现命令 toast 拦截（`composer:toast.builtinNotSupported` + 可选 `builtinHints.*` 提示），未知斜杠透传。本次实装：`/reload` → worker `reloadResources()`（`session.reload`）；`/compact` 修正为 worker `compact` RPC → `session.compact()`（真压缩，不再发文本给模型）。popover 列表由 `commands.list` + `commands.builtins` 合并生成（`use-composer-slash.ts`），`composer-constants.ts` 的 `BUILTIN_COMMANDS` 退役为 `DESKTOP_NATIVE_COMMANDS`。新增 IPC 均已在 `packages/shared/ipc-channels.ts` 登记（有同步门禁）。
