# 会话管理

## Goal
实现会话列表、新建、打开、重命名、删除、fork、clone、compaction 处理。

## Requirements
- 左侧 Sidebar 会话列表（当前项目下）。
- 会话显示名称/时间/token 摘要。
- 新建会话按钮。
- 打开会话恢复历史。
- 重命名会话。
- 删除会话（确认弹窗）。
- fork / clone 会话。
- compaction 分隔标记展示（"已压缩 N 条"，可展开摘要）。
- session export。
- 会话右键菜单（重命名、删除）。
- 会话列表骨架屏 loading 状态。
- 空状态引导。

## Acceptance Criteria
- [ ] 能看到当前项目的会话列表。
- [ ] 能新建会话并开始对话。
- [ ] 能打开已有会话恢复历史。
- [ ] 能重命名和删除会话。
- [ ] compaction 后 Timeline 显示分隔标记。
- [ ] 会话列表有骨架屏和空状态。

## Dependencies
- ipc-contract, pi-worker, i18n-setup, scaffold。
