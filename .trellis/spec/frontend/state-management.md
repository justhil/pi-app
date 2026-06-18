# State Management

> pi Desktop 状态管理规范。

---

## Overview

状态分三层：

| 层 | 工具 | 用途 |
|----|------|------|
| UI 状态 | Zustand | 面板切换、侧栏展开、选中会话、Composer 输入 |
| IPC 数据 | TanStack Query（可选）或自定义 hook | 会话列表、Review diff、Extensions 列表、Settings |
| 实时事件流 | AppEvent subscribe | Timeline 消息、工具卡、Run 状态、文件变更 |

不使用 Redux。Run/Timeline 以 AppEvent 流为主，不把每条事件都塞进全局 store。

---

## State Categories

### UI 状态（Zustand）

放：

- 当前激活面板（Review / Trellis / Run）。
- 侧栏展开/收起。
- 选中会话 ID。
- Composer 输入文本。
- 面板宽度。
- 主题选择。

不放：

- 聊天历史（pi session 是事实来源）。
- 工具调用详情（AppEvent 流驱动）。
- 文件变更列表（Review 从 IPC + 事件流获取）。

### IPC 数据

通过 IPC 请求获取，带缓存：

- workspace 列表。
- session 列表。
- Review diff。
- Extensions 列表。
- Settings。

### 事件流

AppEvent 实时推送，Renderer 按类型分发：

| AppEvent 类型 | 更新目标 |
|---------------|---------|
| message | Timeline |
| tool | Timeline + Run 统计 |
| file | Review 索引 |
| run | Run 面板状态 |

---

## When to Use Global State

- 跨 feature 共享的 UI 状态（当前 workspace、当前 session、当前 run）。
- 不放业务数据（数据走 IPC + 事件流）。

---

## Server State

### 事实来源

pi session JSONL 是会话事实来源。App 不重新存完整聊天历史。

### 索引缓存

App 本地 SQLite 存索引：

- workspace index。
- session index。
- run index。
- turn index。
- file change index。

### 恢复策略

App 重开后从 pi session + SQLite 索引重建 UI。不保证正在跑的任务继续。

---

## Common Mistakes

- 把 AppEvent 全量塞进 Zustand（应该按类型分发到对应 feature）。
- 在 Zustand 里存完整聊天历史（应该用 pi session）。
- 在 Renderer 里直接读 JSONL 文件（应该走 IPC → Worker → pi SDK）。
- 不处理 seq 断号（应该请求快照恢复）。
