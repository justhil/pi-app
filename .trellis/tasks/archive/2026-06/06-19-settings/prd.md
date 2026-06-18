# Settings 页面

## Goal
实现完整 Settings 页面，包含 6 个子页面。

## Requirements
- General：启动行为、最近项目、registry 自动检查开关。
- Appearance：Light/Dark/System、字体大小、code font、density。
- Pi：SDK version、agentDir、当前模型、settings、sessionDir、auth 概览（不显示密钥）。
- Extensions：兼容等级列表、启用/禁用、JSON Schema 配置表单、风险提示。
- Resources：skills/prompts/MCP/themes/packages 展示。
- Diagnostics：Worker 状态、probe 结果、registry 日志、ResourceLoader 错误、AppEvent 错误。
- Settings 用 Dialog 打开，动效 ~200ms。
- 所有文案走 i18n。

## Acceptance Criteria
- [ ] 6 个子页面都能访问和展示。
- [ ] Appearance 能切换 Light/Dark/System。
- [ ] Extensions 能看到兼容等级和启用状态。
- [ ] Resources 能列出 skills/prompts/MCP/themes/packages。
- [ ] Diagnostics 能看到 Worker 状态和错误。

## Dependencies
- i18n-setup, local-storage, scaffold。
