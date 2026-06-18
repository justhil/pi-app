# Extension UI 兼容层

## Goal
实现 Extension 探测、兼容等级判断、白名单管理和禁用机制。

## Requirements
- Extension probe process 探测注册结果（tools/commands）。
- 兼容等级判断：native/basic/headless/blocked。
- 识别规则：只认 tool 名。
- 首批 native 白名单：Trellis / Ask / Image。
- blocked extension 默认禁用。
- 用户手动启用 blocked extension + 风险提示 + 二次确认。
- 启用只影响 App 运行时，不改 pi settings。
- active tools 过滤 fallback。
- adapters/ 目录结构。
- trust gate 前置（未 trust 不加载项目 extension）。

## Acceptance Criteria
- [ ] 能探测 extension 注册的 tools。
- [ ] Trellis 被识别为 native。
- [ ] 未知 extension 被识别为 blocked。
- [ ] blocked extension 不暴露给模型。
- [ ] 用户手动启用有风险提示和确认。
- [ ] 启用/禁用不改 pi settings。

## Dependencies
- pi-worker, ipc-contract, scaffold。
