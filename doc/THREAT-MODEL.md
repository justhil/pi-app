# pi Desktop — 渲染进程威胁模型（摘要）

## 配置

`src/main/window.ts`：`contextIsolation: true`，`nodeIntegration: false`，**`sandbox: false`**。

## 为何 sandbox 关闭

Electron 主进程与部分 native 依赖（如 better-sqlite3、文件系统访问）历史上与 Chromium 渲染沙箱并存时需额外兼容验证。当前选择 **关闭 Chromium sandbox**，依赖：

1. **Preload 最小 API** — `piDesktop.invoke` 仅允许 `packages/shared/ipc-channels.ts` 列表内 channel。
2. **contextIsolation** — 渲染页 JS 不直接持有 Node 能力。
3. **IPC 白名单** — Main 侧 `registerHandler` 与 allowlist 双向测试（`ipc-channel-sync.test.mjs`）。

## 残余风险

- 渲染层 XSS / 恶意内容若突破隔离，攻击面大于 `sandbox: true` 应用。
- 扩展 UI / markdown 预览 / 外部链接需按不可信输入处理。

## 缓解路线图

- 评估 `sandbox: true` + 回归测试（启动、Worker、SQLite、文件对话框）。
- 正式威胁模型评审后更新本文件与 FMSM Security 评分。