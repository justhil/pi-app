# i18next 国际化框架

## Goal
配置 i18next + react-i18next，所有 UI 文案走 i18n key，第一版中文完整。

## Requirements
- i18next + react-i18next 安装和配置。
- locale 目录结构：src/renderer/locales/zh/ 和 en/。
- 中文 locale 文件：common.json, timeline.json, review.json, settings.json。
- 英文 locale 预留空值。
- i18n 配置放 lib/i18n.ts。
- 所有 UI 组件用 t('key') 调用。
- 代码、路径、工具名不翻译。

## Acceptance Criteria
- [ ] i18next 初始化成功，默认语言中文。
- [ ] t('common.send') 等调用能正确渲染中文。
- [ ] 切换到英文能显示空值或 fallback。
- [ ] locale 文件结构完整（common/timeline/review/settings）。

## Dependencies
- scaffold（需要项目结构）。
