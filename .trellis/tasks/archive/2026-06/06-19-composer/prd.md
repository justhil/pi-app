# Composer 底部输入区

## Goal
实现底部输入区，支持多行输入、模型切换、斜杠命令补全、图片粘贴和拖拽。

## Requirements
- 多行输入框（auto-resize）。
- 模型选择入口（走 IPC model.list / model.set）。
- thinking level 选择（走 IPC thinkingLevel.set）。
- 发送 / 停止按钮（状态切换动效 150ms）。
- 斜杠命令补全：输入 / 触发 popover，数据走 IPC commands.list。
- 图片粘贴（Ctrl+V），走 prompt.sendWithImages。
- 图片拖拽到窗口。
- prompt.steer / prompt.followUp 支持。
- 聚焦时边框/ring 动效 150ms。
- 发送中状态禁用输入。

## Acceptance Criteria
- [ ] 能输入多行文本并发送。
- [ ] 能切换模型和 thinking level。
- [ ] 输入 / 能弹出命令补全。
- [ ] 能粘贴图片并发送。
- [ ] 能拖拽图片到窗口。
- [ ] agent 运行时能 steer 和 abort。
- [ ] 发送→Stop 按钮有状态切换动效。

## Dependencies
- ipc-contract, pi-worker, i18n-setup, scaffold。
