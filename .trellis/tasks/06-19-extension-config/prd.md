# Extension 配置页

## Goal
实现 native extension 的 JSON Schema Form 配置页。

## Requirements
- JSON Schema Form 渲染（根据 adapter configSchema）。
- 配置存 App 本地（workspaceId + extensionId）。
- 不写 ~/.pi/agent/settings.json。
- 不写项目 .pi/settings.json。
- Settings → Extensions → 点进插件详情显示配置表单。
- 配置变更即时生效（下次 session/reload）。

## Acceptance Criteria
- [ ] Trellis adapter 的配置表单能渲染。
- [ ] 配置保存到 App 本地。
- [ ] 配置不写 pi settings。
- [ ] 配置变更后 reload 生效。

## Dependencies
- extension-compat, settings, local-storage。
