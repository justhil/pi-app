# 错误处理与恢复

## Goal
实现 Worker 崩溃恢复、extension 加载失败处理、registry 降级和前端错误边界。

## Requirements
- Worker crash 检测 + 自动重启 + pi session 恢复。
- extension 加载失败不阻塞 session，记 Diagnostics。
- registry 拉取失败静默用缓存。
- 前端三层 ErrorBoundary：全局 + Timeline 区域 + per-card。
- per-card 错误显示"渲染失败"占位。
- IPC timeout 处理。
- 所有后端错误进 Diagnostics。
- 结构化日志写本地文件。

## Acceptance Criteria
- [ ] Worker 崩溃后自动重启并恢复会话历史。
- [ ] extension 加载失败不阻塞 session。
- [ ] registry 失败不弹窗。
- [ ] Timeline 单条渲染崩溃不影响其他。
- [ ] 错误能在 Diagnostics 看到。

## Dependencies
- electron-main, pi-worker, scaffold。
