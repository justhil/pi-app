# pi-app 架构上下文（审计 / 重构用）

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

- `src/main/window.ts`：`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`（需威胁模型文档，见 FMSM F4）

## 质量门禁

- `npm run typecheck` — web + node
- `node --test scripts/tests/*.test.mjs` — CI `quality.yml`

## 严苛评分（FMSM 2026-07-01）

| 项 | 严苛分 | PRD 目标 |
|----|--------|----------|
| Overall | **7.9 B**（iter11）；Maintainability 8.0 | ≥8.0 A 差 ~0.1 |
| Testing | **7.0**（脚本 39 cases） | ≥7.0 ✓ |
| ipc **36**；ui-store **329**；apply-app-event **71**；worker `as any` **≤22** | 见 `worker-message.ts` |

任务：`07-01-07-01-arch-strict-to-a`（达标后归档）。威胁模型：`doc/THREAT-MODEL.md`。