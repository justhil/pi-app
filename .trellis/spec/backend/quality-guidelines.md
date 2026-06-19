# Quality Guidelines

> pi Desktop 后端代码质量规范。

---

## Overview

后端代码质量核心：进程边界清晰、IPC 契约稳定、事实来源单一、extension 兼容不越界。

---

## Forbidden Patterns

| 模式 | 原因 |
|------|------|
| Renderer 直接 import Node 模块 | 必须走 IPC |
| Renderer 直接 import pi SDK | 必须走 Worker + AppEvent |
| Main 直接执行 pi agent 逻辑 | 应该交给 Worker |
| Worker 直接渲染 UI | 应该只输出 AppEvent |
| App DB 存完整聊天历史 | pi session 是事实来源 |
| 直接读 JSONL 文件 | 应该走 Worker → SDK |
| remote registry 下发 JS/React | 安全红线 |
| extension 注入任意前端组件 | 安全红线 |
| 改 ~/.pi/agent/settings.json | **A 层原生配置除外**：原生设置允许写回（见 docs/tui-replacement-and-adapters.md §2.5）；**扩展配置**仍禁止 |
| 改项目 .pi/settings.json | **A 层项目覆盖除外**：原生项目设置允许写回；**扩展配置**仍禁止 |
| blocked extension 不经用户确认就启用 | 必须有风险提示 + 确认 |
| Registry 更新在 running turn 中途生效 | 应等 reload / 新 session |
| 不校验 remote registry JSON | 必须签名 + schema 校验 |
| Renderer nodeIntegration 不关 | 必须 false + contextIsolation: true + sandbox: true |
| Worker 用 child_process.fork | 必须用 utilityProcess + MessageChannel |

---

## Required Patterns

| 模式 | 要求 |
|------|------|
| IPC 契约在 packages/shared 定义 | Renderer/Main/Worker 共享 |
| AppEvent 走 normalizer | Renderer 不直接吃 SDK event |
| Worker 一个项目一个 | 切项目换 Worker |
| extension 探测与正式运行分离 | probe process → allowed list → 正式 Worker |
| extension 兼容按整体判定 | 不做 tool 粒度拆分（B 层） |
| 命令权威源 = Worker session get_commands | 不用 Main 扫目录（A 层硬约束） |
| 扩展 / 命令桌面表现按语义分流 | 启停类→提示渲染；进配置页类→适配器配置页 |
| 未登记扩展不显示「桌面适配器」 | 仅 plugin-adapter-meta 登记且 tier≠none 才显示 |
| blocked extension 用 active tools 过滤 | fallback 方案 |
| remote registry 必须签名 | Ed25519 |
| rendererId 必须本地存在 | 未知则降级或 blocked |
| extension 配置存 App 本地 | 不写 pi settings |
| 所有后端错误进 Diagnostics | 可查可追溯 |

---

## Testing Requirements

- IPC 契约测试：方法签名 + 参数校验。
- AppEvent schema 测试：四类事件的 zod/typebox 校验。
- Event normalizer 测试：pi SDK event → AppEvent 转换正确性。
- Extension probe 测试：探测结果 → 兼容等级判断。
- Registry verifier 测试：签名校验、schema 校验、未知 rendererId 拒绝。

---

## Code Review Checklist

- [ ] 进程边界是否清晰（Renderer/Main/Worker 不越界）？
- [ ] IPC 方法是否在 packages/shared 定义？
- [ ] AppEvent 是否经过 normalizer？
- [ ] Worker 是否一个项目一个？
- [ ] 是否误把 A 层原生命令塞进适配器？（/model、/skill:、/prompt: 属 A）
- [ ] 是否误给未登记扩展显示「桌面适配器：包名」？
- [ ] 原生 settings 改动是否经 Worker SettingsManager 写回（而非手写 JSON）？
- [ ] 扩展配置是否仍走 app-local（未写 pi settings）？
- [ ] Extension 兼容是否按整体判定？
- [ ] Remote registry 是否签名 + schema 校验？
- [ ] rendererId 是否在本地白名单？
- [ ] 是否改了 pi 全局或项目配置？
- [ ] 错误是否进 Diagnostics？
- [ ] blocked extension 是否经过用户确认？
