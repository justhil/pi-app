# 集成测试与验收

## Goal
端到端集成测试，验证所有 AC。

## Requirements
- AC1-AC17 逐项验收。
- 端到端流程：打开项目 → 新建会话 → 发 prompt → 看工具卡 → 看 diff → 看 Run → 看 Trellis。
- Extension 兼容流程：加载 Trellis → native 卡片 → blocked extension → 手动启用。
- 错误恢复流程：Worker crash → 重启 → 恢复。
- UI 风格检查：反 AI slop 自检 8 条。
- i18n 检查：无硬编码字符串。
- 打包检查：能产出安装包。

## Acceptance Criteria
- [ ] AC1-AC17 全部通过。
- [ ] 端到端流程无阻塞。
- [ ] 反 AI slop 自检通过。
- [ ] 无硬编码 UI 字符串。

## Dependencies
- 全部子任务完成。
