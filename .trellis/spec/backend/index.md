# Backend Development Guidelines

> pi Desktop 后端规范：Electron Main、Pi Worker、IPC、本地存储、Extension 兼容层。
> 与 `docs/architecture.md` 并列。

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
