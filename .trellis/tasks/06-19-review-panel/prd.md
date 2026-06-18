# Review 面板

## Goal
实现右侧 Review 面板，支持 Turn/Session/Git 三种范围切换和 diff 渲染。

## Requirements
- Turn / Session / Git 三种范围 tab 切换。
- edit/write 工具事件归因到 turnId/sessionId。
- turn 前后 git diff 快照（检测 bash 改文件）。
- DiffModel 统一模型。
- inline diff 渲染。
- 大文件 / lockfile / generated 默认折叠。
- binary 文件显示摘要。
- 复制路径按钮。
- 打开外部编辑器按钮。
- 文件右键菜单（复制路径、打开文件）。
- 虚拟列表渲染长 diff（react-window）。
- Git 只读（不 commit / stash / checkout）。
- 文件列表骨架屏 loading 状态。
- Tab 切换 cross-fade 动效。

## Acceptance Criteria
- [ ] Turn 范围只显示当前轮次改动。
- [ ] Session 范围显示累计改动。
- [ ] Git 范围显示当前工作区 diff。
- [ ] bash 改的文件能被检测（bash-diff 标记）。
- [ ] 大文件自动折叠。
- [ ] 能复制路径和打开编辑器。
- [ ] 长 diff 不卡顿（虚拟列表）。

## Dependencies
- ipc-contract, pi-worker, scaffold。
