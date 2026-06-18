# Logging Guidelines

> pi Desktop 日志和 Diagnostics 规范。

---

## Overview

桌面端日志分两层：进程日志（文件）和 Diagnostics 面板（UI 可见）。用户不需要看进程日志，但需要能从 Diagnostics 看到关键状态和错误。

---

## Log Levels

| 级别 | 何时用 |
|------|--------|
| error | Worker 崩溃、extension 加载失败、registry 校验失败、SQLite 读写失败 |
| warn | extension 降级为 blocked、registry 使用缓存、IPC 超时、session 读取异常 |
| info | Worker 启动/停止、项目切换、registry 更新成功 |
| debug | AppEvent 流、extension probe 结果、active tools 列表 |

生产构建默认 info 级别。开发构建默认 debug。

---

## What to Log

### 必须记

- Worker 启动 / 停止 / 崩溃 / 重启。
- Extension 加载结果（成功 / 失败 / blocked）。
- Extension probe 注册的 tools / commands。
- Remote registry 拉取 / 校验 / 合并结果。
- Active tools 过滤决策。
- Session 打开 / 新建 / fork。
- IPC 错误。

### Diagnostics 面板显示

- Worker 状态。
- Extension probe 结果。
- Registry 更新日志（时间、版本、成功/失败）。
- ResourceLoader 错误。
- 最近 AppEvent 错误。

---

## What NOT to Log

| 禁止 | 原因 |
|------|------|
| API key / OAuth token | 安全 |
| auth.json 内容 | 安全 |
| 完整聊天内容 | 隐私 + 体积 |
| 完整 tool output | 体积（只记 isError + 摘要） |
| 用户文件内容 | 隐私 |

---

## Structured Logging

进程日志用结构化 JSON，写到本地日志文件：

```
%APPDATA%/pi-desktop/logs/
  main.log
  worker.log
```

每条日志：

```json
{
  "level": "info",
  "timestamp": "2026-06-18T16:00:00.000Z",
  "module": "worker-manager",
  "message": "Worker started",
  "workspaceId": "D:/workspace/pi-app"
}
```

---

## Common Mistakes

- 把完整聊天内容写日志（应该只记元数据）。
- 把 API key 写日志（应该禁止）。
- Diagnostics 面板堆满原始 AppEvent（应该只显示错误和关键状态）。
- 不记 registry 校验失败原因（应该记，方便排查）。
