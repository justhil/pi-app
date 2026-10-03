# IPC 契约（Backend-API 边界）

与 `packages/shared/ipc-channels.ts` 同步。Main 实现见 `src/main/ipc/handlers/`。

## 类型边界

- `registerHandler(channel, fn)` — `IpcInvokeBody` 为文档类型；**settings 等 handler 在实现内用 `keyof StoreSchema` 窄化**（见 `handlers/settings.ts`）。
- Renderer 仅通过 preload allowlist `invoke(channel, body)`。

## 高频 channel

| Channel | Request | Response |
|---------|---------|----------|
| `ipc:settings.get` | `{ key?: keyof StoreSchema }` | `{ settings: Partial<StoreSchema> }` |
| `ipc:settings.set` | `{ key: keyof StoreSchema; value: StoreSchema[key] }` | `{ key, value }` |
| `ipc:runtime.getState` | `{}` | Worker/runtime 快照 |
| `ipc:session.list` | workspace 相关字段 | 会话列表 |

## 内置浏览器（`ipc:browser.*`，实验）

Main 在第一次 `tabs.open` 时才创建 `BrowserHost`；没有打开过标签时，其余 channel 都是空操作。类型见 `packages/shared/browser-types.ts`。

| Channel | Request | Response |
|---------|---------|----------|
| `ipc:browser.tabs.list` | `{}` | `{ tabs: BrowserTabInfo[]; activeTabId: string \| null }` |
| `ipc:browser.tabs.open` | `{ url?: string; profileId?: string }` | `{ tab: BrowserTabInfo }` |
| `ipc:browser.tabs.close` / `ipc:browser.tabs.focus` | `{ tabId }` | `{ ok: true }` |
| `ipc:browser.navigate` | `{ tabId; url }` 或 `{ tabId; history: 'back' \| 'forward' \| 'reload' \| 'stop' }` | `{ ok: true }`；非 http(s) 地址会被拒绝 |
| `ipc:browser.viewBounds` | `BrowserViewBounds`（占位元素的 client rect + `visible`） | `{ ok: true }` |
| `ipc:browser.capture` | `{ tabId }` | `{ dataUrl: string \| null }`（被弹层遮挡时用作占位图） |
| `ipc:browser.hideAll` / `ipc:browser.shutdown` | `{}` | `{ ok: true }` |
| `ipc:browser.profile.clear` | `{ profileId?: string }` | `{ ok: true }` |

Main → Renderer 的事件走 `ipc:browser-event`（`BrowserEvent`：`tab-updated` / `tab-closed` / `tab-focused` / `download` / `shortcut`）。

## 回归

`scripts/tests/ipc-channel-sync.test.mjs` — allowlist ↔ `registerHandler` 双向一致。