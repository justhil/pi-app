# Remote Adapter Registry

## Goal
实现远程 registry 拉取、签名校验、合并和缓存。

## Requirements
- built-in registry（App 内置）。
- 远程 GitHub JSON 拉取。
- Ed25519 签名校验（App 内置公钥）。
- JSON Schema 校验。
- rendererId 白名单校验。
- 每天最多一次自动检查。
- 失败静默用缓存或 built-in。
- Settings 手动刷新/关闭。
- registry 更新不在 running turn 中途生效。
- registry cache 存 SQLite。

## Acceptance Criteria
- [ ] 能拉取远程 registry 并校验签名。
- [ ] 签名失败时拒绝更新并用缓存。
- [ ] 未知 rendererId 被拒绝。
- [ ] 拉取失败不弹窗。
- [ ] Settings 能手动刷新 registry。

## Dependencies
- electron-main, extension-compat, local-storage。
