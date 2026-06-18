# Timeline 主区域

## Goal
实现中间执行时间线，展示用户消息、AI 回复、工具调用卡片和 compaction 标记。

## Requirements
- 用户消息展示。
- AI 回复流式渲染（text delta）。
- 工具调用卡片：read / write / edit / bash。
- bash 输出折叠展示。
- edit diff 片段内联展示。
- 工具卡展开/折叠（Radix Collapsible）。
- 错误状态醒目展示。
- compaction 分隔标记。
- 新卡片入场动效（fade + translateY 4-8px, 200ms, stagger 前 5 条）。
- 流式打字不额外做块级动画。
- Timeline 区域 ErrorBoundary。
- 消息右键菜单（复制）。
- Markdown 渲染（react-markdown）。
- 代码高亮（Shiki in Web Worker）。

## Acceptance Criteria
- [ ] 能看到流式 AI 回复。
- [ ] 工具调用以卡片展示，bash 输出可折叠。
- [ ] edit 工具展示内联 diff。
- [ ] 工具卡能展开折叠。
- [ ] 错误状态清晰可见。
- [ ] 新卡片有入场动效。
- [ ] Timeline 渲染崩溃不影响其他区域。

## Dependencies
- ipc-contract, pi-worker, i18n-setup, scaffold。
