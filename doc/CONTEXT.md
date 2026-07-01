# pi Desktop — Domain Context (architecture vocabulary)

Terms for architecture reviews (`improve-codebase-architecture`, Trellis). Not user-facing copy.

| Term | Meaning |
|------|---------|
| **Session** | pi SDK 磁盘 JSONL 会话；事实来源在 `~/.pi/agent`，非 App SQLite 正文 |
| **Workspace** | 用户打开的项目目录（cwd）；沙箱工作区为受控子集 |
| **AppEvent** | Main/Worker → Renderer 的统一事件流（message/tool/run/queue…） |
| **IPC channel** | Renderer 经 preload `invoke` 调 Main 的命名端点 |
| **Worker** | 单 utilityProcess 上的 pi SDK 运行时；一 cwd 对应 worker 生命周期 |
| **Adapter** | `adapter.json` 描述的扩展兼容配置；App 零插件名分支 |
| **Extension UI** | SDK 扩展触发的 dialog/notify；经 desktop-ui-bridge 到 Renderer |
| **Timeline** | 渲染会话历史的 UI 模块；消费 HistoryItem + AppEvent |
| **Composer** | 用户输入与附件、队列、slash 的 UI 模块 |
| **ui-store** | Zustand 上帝 store：时间线、run 状态、扩展 UI 副作用（待加深） |
| **ipc surface** | `registerAllHandlers` 注册的全部 channel（待按 seam 拆分） |

**Seams (target)**

- Renderer ↔ preload ↔ Main (IPC)
- Main ↔ Worker (utilityProcess message)
- Worker ↔ pi SDK (dynamic import)
- extension-compat ↔ Renderer (adapter 表驱动)