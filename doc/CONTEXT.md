# pi-app 架构上下文（审计 / 重构用）

### 决策记录：侧栏项目固定顺序（2026）

侧栏项目列表默认按最近使用（MRU）排序：打开项目时 `configStore.addRecentProject` 把项目移到最前，且当前工作区始终置顶（`project-sidebar.tsx` 的 `diskPaths`）。新增配置项 `recentProjectsFixedOrder`（默认 `false`，保持 MRU 行为）：开启后 `nextRecentProjects` 不再移动已有项目（新项目追加到末尾），侧栏按存储顺序展示且当前项目不置顶（仅高亮）。纯函数：`src/main/recent-projects.ts`、`src/renderer/src/features/workspace/project-folder-order.ts`。设置页「最近项目」区开关直接写配置并派发 `pi-desktop:settings-changed` 事件通知侧栏即时重排。

**闪烁根因（勿回退）**：`ui-store.setWorkspace` 曾把当前工作区 unshift 到 `recentProjects` 最前——固定模式下侧栏先跳顶，随后 `reloadSidebarSettings` 从主进程拉回真实顺序——先跳再弹回 = 每次切换可见闪烁。修复：`setWorkspace` 不再重排 `recentProjects`（侧栏顺序以主进程配置为唯一事实源；MRU 模式由 `projectFolderOrder` 的“当前置顶”规则兜底即时显示）。另：`reloadSidebarSettings` 在顺序无变化时保持数组引用稳定，避免固定模式下每次切换都触发整个侧栏重渲染。

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