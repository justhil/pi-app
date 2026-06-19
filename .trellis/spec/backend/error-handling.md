# Error Handling

> pi Desktop 异常处理和恢复策略。

---

## Overview

桌面端三层进程各有失败模式。第一版不做长任务续跑，恢复依赖 pi session。

---

## Error Types

| 类型 | 来源 | 处理 |
|------|------|------|
| Worker crash | Pi Worker 进程崩溃 | 重启 Worker，从 pi session 恢复历史 |
| Extension load error | extension 加载失败 | 记录到 Diagnostics，不阻塞 session |
| A 层原生 settings 写回失败 | SettingsManager 写盘失败 | 提示用户并回滚 UI 状态 |
| 未登记扩展被当作适配器 | 探测分类错误 | 不显示「桌面适配器」，仅走插件页 |
| Extension probe error | 探测进程失败 | 降级为 blocked，记日志 |
| Registry fetch failure | 远程 registry 拉取失败 | 静默使用缓存或 built-in |
| Registry verify failure | 签名/schema 校验失败 | 拒绝更新，用上次缓存 |
| IPC timeout | Renderer ↔ Main ↔ Worker 超时 | Renderer 显示错误状态 |
| Session read error | pi session JSONL 损坏 | 显示错误，尝试列出可用 session |
| Model API error | pi SDK 调用模型失败 | 透传 pi 错误信息到 Timeline |
| SQLite error | 索引读写失败 | 降级为无索引，不影响核心功能 |

---

## Error Handling Patterns

### Worker crash

```text
Worker 崩溃
  ↓
Main 检测到 Worker 退出
  ↓
Renderer 显示 "连接断开，正在恢复"
  ↓
重启 Worker
  ↓
从 pi session 恢复历史
  ↓
不保证正在跑的任务继续
```

### Extension load error

```text
extension 加载失败
  ↓
记录错误到 Diagnostics
  ↓
不阻塞 session 启动
  ↓
Settings 显示加载错误
```

### Registry failure

```text
远程 registry 拉取失败
  ↓
静默
  ↓
使用上次缓存
  ↓
无缓存则用 built-in registry
  ↓
不影响启动
```

---

## Error Propagation

### Worker → Main → Renderer

- Worker 产生的错误通过 AppEvent（RunEvent phase=failed）传递。
- Worker 进程崩溃由 Main 检测，通知 Renderer。
- 不让 Worker 崩溃拖死 Electron 主窗口。

### Renderer 内

- IPC 调用失败：就近显示错误（Timeline / Run / Settings）。
- AppEvent 断号：请求快照恢复。
- 不用全局 error boundary 吞掉所有错误。

---

## Common Mistakes

- Worker 崩溃后不重启（应该自动重启并恢复）。
- extension 加载失败就阻塞整个 session（应该跳过并记录）。
- registry 失败就弹窗（应该静默降级）。
- 把所有错误都塞进全局 error boundary（应该就近显示）。
- 不记 Diagnostics（应该所有后端错误都进 Diagnostics）。
