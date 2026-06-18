# Run 面板

## Goal
实现右侧 Run 面板，显示当前 agent 运行摘要。

## Requirements
- Running / Idle / Failed 状态显示。
- 当前模型 + thinking level。
- 耗时显示。
- token / cost 显示。
- 工具调用数量 + 错误数量。
- 当前活动工具。
- 细进度条（运行中）。
- 数据从 RunEvent 流驱动。

## Acceptance Criteria
- [ ] agent 运行时显示 Running + 进度条。
- [ ] 能看到当前模型和 thinking level。
- [ ] 能看到 token/cost 实时更新。
- [ ] agent 空闲时显示 Idle。
- [ ] agent 失败时显示 Failed + 错误信息。

## Dependencies
- ipc-contract, pi-worker, scaffold。
