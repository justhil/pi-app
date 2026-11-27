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
| `ipc:browser.find` | `{ tabId, text, forward?, findNext? }` | `{ ok }`；结果以 `find-result` 事件返回（`findNext=true` 表示在当前查找中移动） |
| `ipc:browser.find.stop` | `{ tabId }` | `{ ok }` |
| `ipc:browser.downloads.list` | — | `{ downloads: BrowserDownloadInfo[] }` |
| `ipc:browser.downloads.cancel` | `{ id }` | `{ ok }`（aria2 下载会删除未完成文件和 .aria2 控制文件） |
| `ipc:browser.downloads.reveal` | `{ id }` | `{ ok }` |
| `ipc:browser.downloads.clear` | — | `{ downloads }`（清除已结束的条目） |
| `ipc:browser.downloader.status` | `{ aria2Path? }` | `{ path: string \| null, version: string \| null }` |
| `ipc:browser.inspectPoint` | `{ tabId; x; y; deep?: boolean }` | `{ element: ElementDescriptor \| null }`；在隔离 world 中执行，`deep` 且为开发地址时额外在主 world 读取框架源码位置 |
| `ipc:browser.pageContext` | `{ tabId; saveText?: boolean }` | `PageContextResult`（不含 `text`）+ `path`（`saveText` 时正文写成 `.md` 临时文件） |
| `ipc:browser.logs` | `{ tabId; max?: number }` | `{ entries: BrowserLogEntry[] }`（console 错误/警告、失败请求或状态码 ≥ 400 的请求） |
| `ipc:browser.scroll` | `{ tabId; x; y; deltaY }` | `{ ok: true }`（真实滚轮输入） |
| `ipc:browser.hideAll` / `ipc:browser.shutdown` | `{}` | `{ ok: true }` |
| `ipc:browser.profile.clear` | `{ profileId?: string }` | `{ ok: true }` |

Main → Renderer 的事件走 `ipc:browser-event`（`BrowserEvent`：`tab-updated` / `tab-closed` / `tab-focused` / `download` / `shortcut`）。

Renderer 内部事件 `pi-desktop:composer-attach-files` 的 `detail` 为 `{ files?: {path,name,kind}[]; text?: string }`：`text` 插在附件之前，可以只带 `text`。浏览器的截图、页面正文、批注、日志都通过这个事件放进输入框，**不会自动发送**。

## Google AI Ultra 方案（`ipc:googleAiPlan.*`，预览）

扩展代码来自上游 PR 的 head 提交（通常在作者的 fork 上），安装后以 pi 扩展的全部权限运行，所以安装必须经用户按提交确认。

| Channel | Request | Response |
|---------|---------|----------|
| `ipc:googleAiPlan.status` | `{}` | `GoogleAiPlanStatus` |
| `ipc:googleAiPlan.previewSync` | `{}` | `GoogleAiPlanSyncPreviewResponse`：`upstream` 给出将要下载的仓库和完整提交号；拿不到确切提交号（GitHub API 不可达）时 `sha` 为 `null`。只查询，不下载 |
| `ipc:googleAiPlan.syncExtension` | `{ sha }`（用户在预览中确认的提交） | `GoogleAiPlanActionResponse`；PR head 已不是该提交时返回 `UPSTREAM_CHANGED`，拿不到确切提交号时返回 `UPSTREAM_SHA_UNAVAILABLE`，都不安装 |
| `ipc:googleAiPlan.removeExtension` | `{}` | `GoogleAiPlanActionResponse` |
| `ipc:googleAiPlan.loginStart` | `{}` | `GoogleAiPlanActionResponse`；未安装扩展时返回 `EXTENSION_NOT_INSTALLED`，从不自行下载 |
| `ipc:googleAiPlan.loginSubmitUrl` | `{ callbackUrl }` | `GoogleAiPlanActionResponse` |
| `ipc:googleAiPlan.loginCancel` / `ipc:googleAiPlan.logout` | `{}` | `GoogleAiPlanActionResponse` |

## 回归

`scripts/tests/ipc-channel-sync.test.mjs` — allowlist ↔ `registerHandler` 双向一致。