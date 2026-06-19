# Backend Development Guidelines

> pi Desktop 后端规范：Electron Main、Pi Worker、IPC、本地存储、Extension 兼容层。
> 与 `docs/architecture.md`、`docs/tui-replacement-and-adapters.md`、**`docs/adapter-layer-plan.md`** 并列。
>
> **A/B/C 分层**：A 层(pi/TUI 原生复刻)、B 层(扩展适配器)、C 层(纯 TUI 装饰)是后端命令系统、settings 写回、扩展兼容的硬约束。
>
> **兼容层 v2（最高边界）**：App 本体除 pi 内核外**零具体插件专属代码**，包括 trellis/ask（不再作为 native 例外）。所有插件走声明式 `adapter.json` + 预设 UI 原语（配置页 / 工具卡 / 交互式工具 UI）。权威文档 `docs/adapter-layer-plan.md`；旧 `tui-replacement-and-adapters.md` 的 native 例外处理作废。

---

## Overview

pi Desktop 后端不是传统服务器，而是 Electron 桌面端的三层进程：

```
Electron Main
  ├─ Window lifecycle
  ├─ IPC routing
  ├─ App local config (electron-store)
  ├─ SQLite index
  ├─ Worker lifecycle
  ├─ Remote registry fetch/cache/verify
  │
  └─ Pi Worker
       ├─ createAgentSessionRuntime
       ├─ ResourceLoader
       ├─ Extension loading + probe
       ├─ AppEvent normalizer
       ├─ Tool/message/run event bridge
       ├─ Active tools filtering fallback
       │
       └─ pi Core / SDK
            ├─ models / tools / sessions JSONL
            ├─ extensions / skills / prompts
            └─ MCP
```

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Database Guidelines](./database-guidelines.md) | SQLite index, electron-store, pi session | Filled |
| [Error Handling](./error-handling.md) | Worker crash, registry failure, session recovery | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, IPC contract, forbidden patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Diagnostics, AppEvent errors, probe results | Filled |

---

**Language**: 文档使用中文。代码、路径、工具名保持英文原样。
