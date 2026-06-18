# Directory Structure

> pi Desktop 后端目录结构。

---

## Overview

后端代码分三个进程边界：Main、Worker、Shared。不混用。

---

## Directory Layout

```
src/main/
  main.ts              # Electron 入口
  window.ts            # 窗口生命周期
  updater.ts           # 自动更新
  ipc.ts               # IPC routing broker
  worker-manager.ts    # Pi Worker 生命周期
  permission-gate.ts   # 预留：权限网关
  config-store.ts      # electron-store 封装
  sqlite-index.ts      # SQLite 索引封装

src/worker/
  index.ts             # Worker 入口
  runtime-manager.ts   # createAgentSessionRuntime 封装
  pi-sdk-adapter.ts    # pi SDK 调用
  session-service.ts   # session list/open/new/fork
  auth-service.ts      # AuthStorage / ModelRegistry
  event-normalizer.ts  # pi SDK event → AppEvent
  extension-probe.ts   # extension 探测进程
  active-tools-filter.ts  # active tools 过滤 fallback

src/extension-compat/
  built-in-renderers.ts
  compatibility-registry.ts
  registry-loader.ts
  registry-verifier.ts
  runtime-gate.ts
  adapters/
    trellis/
      renderers.ts
      defaults.ts
    ask/
      renderers.ts
      defaults.ts
    image/
      renderers.ts
      defaults.ts

packages/shared/
  ipc-contract.ts      # IPC 方法签名
  app-events.ts        # AppEvent 类型
  schemas.ts           # zod/typebox 校验
```

---

## Module Organization

### Main 进程

- 管窗口、菜单、IPC 路由、Worker 生命周期、本地存储。
- 不直接执行 pi agent 逻辑。
- 不直接渲染 UI。

### Worker 进程

- 用 Electron `utilityProcess.fork()` 创建。
- Main ↔ Worker 用 `MessageChannel` 双向通信。
- 跑 pi SDK、AgentSessionRuntime。
- 加载 extensions（通过 ResourceLoader）。
- 把 SDK 事件转成 AppEvent。
- 一个当前项目对应一个 Worker。
- 不选 child_process.fork()：和 Electron 生命周期绑定差。

### Shared

- Renderer / Main / Worker 共享的类型和校验。
- 不包含运行时逻辑。

### Extension Compat

- extension 兼容判断、registry 加载校验、renderer 映射。
- 不包含 extension 本身的执行逻辑。

---

## Naming Conventions

- 文件名：kebab-case。
- 函数名：camelCase。
- IPC 方法名：`domain.action`（`session.list`、`prompt.send`）。
- AppEvent 类型：PascalCase + Event 后缀。

---

## Examples

- Worker 管理：`src/main/worker-manager.ts`
- 事件转换：`src/worker/event-normalizer.ts`
- Extension 探测：`src/worker/extension-probe.ts`
- Registry 校验：`src/extension-compat/registry-verifier.ts`
- Worker 通信：`utilityProcess` + `MessageChannel`
