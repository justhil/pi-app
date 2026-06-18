# IPC 契约与 AppEvent 类型

## Goal
定义 Renderer / Main / Worker 共享的 IPC 契约和 AppEvent 类型系统。

## Requirements
- packages/shared/ipc-contract.ts：完整 IPC 方法签名（见 architecture.md §13.1）。
- packages/shared/app-events.ts：AppEvent 四类类型定义。
- packages/shared/schemas.ts：zod 或 typebox 运行时校验。
- AppEvent 基础字段：seq, workspaceId, sessionId, runId, turnId, timestamp。
- DiffModel 类型定义。
- Extension compatibility 类型定义。

## Acceptance Criteria
- [ ] 所有 IPC 方法有 TypeScript 签名。
- [ ] AppEvent 四类类型完整定义。
- [ ] zod/typebox schema 能校验 AppEvent 实例。
- [ ] DiffModel 和 CompatibilityLevel 类型导出可用。

## Dependencies
- scaffold（需要 packages/shared 目录）。
