# Trellis 只读面板

## Goal
实现右侧 Trellis 面板，只读展示当前任务、阶段、验收条件和 journal。

## Requirements
- TrellisReader 实现。
- 优先调用 .trellis/scripts/get_context.py 和 task.py current。
- fallback 直接读 .trellis/tasks/ 和 workspace/journal 文件。
- 显示：当前任务、阶段、验收条件、最近 journal。
- 无 .trellis 时显示"未启用 Trellis"。
- 只读红线：禁止调用 task.py start / archive / add_session.py。
- 刷新策略：进入项目 / 切 session / 手动刷新 / mtime 变化。

## Acceptance Criteria
- [ ] 有 .trellis 时能显示当前任务和阶段。
- [ ] 能显示验收条件。
- [ ] 能显示最近 journal。
- [ ] 无 .trellis 时显示未启用提示。
- [ ] 不调用任何修改 .trellis 的命令。

## Dependencies
- ipc-contract, scaffold, i18n-setup。
