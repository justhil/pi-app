# pi Desktop — 渲染进程威胁模型（摘要）

## 配置

`src/main/window.ts`：`contextIsolation: true`，`nodeIntegration: false`，**`sandbox: true`**（默认；`PI_RENDERER_SANDBOX=0` 可关闭用于调试）。

## 为何曾关闭 sandbox（历史）

Electron 主进程与部分 native 依赖曾与 Chromium 渲染沙箱并存时需额外兼容验证。**2026-07-01 起默认开启 sandbox**（`e2e/smoke.spec.ts` 验证）。关闭时仍依赖：

1. **Preload 最小 API** — `piDesktop.invoke` 仅允许 `packages/shared/ipc-channels.ts` 列表内 channel。
2. **contextIsolation** — 渲染页 JS 不直接持有 Node 能力。
3. **IPC 白名单** — Main 侧 `registerHandler` 与 allowlist 双向测试（`ipc-channel-sync.test.mjs`）。

## 残余风险

- 渲染层 XSS / 恶意内容若突破隔离，攻击面大于 `sandbox: true` 应用。
- 扩展 UI / markdown 预览 / 外部链接需按不可信输入处理。

## 补偿控制（sandbox:false 期间）

1. **不可信内容**：会话 markdown、工具输出、扩展 UI 按不可信 HTML/链接处理；避免 `dangerouslySetInnerHTML` 无 sanitize。
2. **导航**：`shell.openExternal` 仅对用户显式操作；不在渲染进程自动跟随不可信 URL。
3. **Preload**：保持最小 API；新 channel 必须进 `ipc-channels.ts` 与契约测试。
4. **开发期**：Vite HMR 下不收紧全局 CSP，避免破坏 dev；发布构建可评估更严 CSP（需单独回归）。

## 关闭 sandbox（仅调试）

设置 **`PI_RENDERER_SANDBOX=0`** 后重启，等同于旧版 `sandbox: false`。

验证：

```bash
npm run build
npm run test:e2e
```

用例覆盖默认启动与显式 `PI_RENDERER_SANDBOX=1`（与默认等价）。

## 缓解路线图

- 默认改为 `sandbox: true` 前需在 Win/macOS/Linux 全矩阵通过 `test:e2e` 与手工附件/Worker 冒烟。
- 正式威胁模型评审后更新本文件与 FMSM Security 评分。

## Codex token 存储（2026-07-01）

- 用户设置的 `codexAccessToken` 经 Electron `safeStorage` 加密，键 `codexAccessTokenEnc`；**不**写入 `asrConfig` 明文 JSON。
- 启动/读取设置时 `loadAsrConfig()` 会迁移历史明文 token 并擦除 store 内字段。

## 发布门禁（iter14）

- CI：`scripts/ci-audit.mjs`（**critical** 阻断；**high** 仅 warn，见 `doc/CONTRIBUTING.md`）。
- IPC：allowlist + `doc/IPC-CONTRACTS.md`。
- **残余风险已文档化**；严苛 Security 评分以「可控残余」计，不以 sandbox:false 单独判 High。