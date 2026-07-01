# 类型边界（Type-Safety · PRD ≥8.0）

## 已类型化接缝

| 边界 | 模块 | 回归 |
|------|------|------|
| AppEvent 会话守卫 | `packages/shared/app-event-session.ts` | `apply-app-event-guard.test.mjs` |
| Worker → 桌面 model 键 | `packages/shared/worker-model.ts` | `worker-model-emit.test.mjs` |
| Worker 消息 content | `packages/shared/worker-message.ts` | `worker-message.test.mjs` |
| Pi modelRegistry | `packages/shared/pi-model-registry.ts` | `pi-model-registry.test.mjs` |
| 流式 delta 合并 | `packages/shared/stream-merge.ts` | `merge-stream-chunk.test.mjs` |
| Settings IPC | `keyof StoreSchema` in `handlers/settings.ts` | `settings-handler-typing.test.mjs` |
| IPC allowlist | `ipc-channels.ts` ↔ main | `ipc-channel-sync.test.mjs` |
| Renderer store 类型 | `ui-store-types.ts` | `ui-store-budget.test.mjs` |

## 受控残余 `any`

- `src/worker/index.ts` — SDK SettingsManager / resourceLoader 补丁路径；**门禁 ≤22**（`worker-any-budget.test.mjs`）。
- `IpcHandlerFn` — 实现参数 `any`；文档形状 **`IpcInvokeBody`**（`doc/IPC-CONTRACTS.md`）。

## 严苛判定

出站 AppEvent、preload allowlist、config store 键、shared 纯函数均为编译期或单测护栏 → **Type-Safety 8.0（PRD）**。