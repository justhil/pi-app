# Extension 原生卡片

## Goal
实现 Trellis / Ask / Image 三个 native adapter 的桌面原生卡片渲染。

## Requirements
- Trellis 子 agent 进度卡片（timeline card + Run 摘要）。
- Ask 选择/确认/输入卡片（modal / timeline card）。
- Image 生成/审查卡片（timeline card + 大图 preview dialog）。
- 交互位置规则按 architecture.md §18。
- 渲染识别：toolName / details.kind → rendererId → React renderer。
- 未知 details.kind 用 generic tool card。
- Ask confirm → modal, select → timeline card, preview → 左右分栏。
- Image 生成中 → timeline card, 结果 → image card, 审查 → modal/preview。

## Acceptance Criteria
- [ ] Trellis 子 agent 进度能以原生卡片展示。
- [ ] Ask 工具的选择/确认能以桌面 UI 展示。
- [ ] Image 工具的生成结果能以图片卡片展示。
- [ ] 图片审查能打开大图 preview。
- [ ] 未知 tool 用 generic card 兜底。

## Dependencies
- extension-compat, timeline, scaffold。
