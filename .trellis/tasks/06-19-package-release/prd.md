# 打包与分发

## Goal
配置 electron-builder 打包和自动更新，产出可分发安装包。

## Requirements
- electron-builder + NSIS 配置。
- Windows 安装包产出。
- 代码签名第一版不做（后续补）。
- electron-updater 框架就位。
- pi SDK 版本锁定在 package.json。
- GitHub Releases 分发。
- 不做 macOS/Linux 打包。

## Acceptance Criteria
- [ ] electron-builder 能打包出 Windows NSIS 安装包。
- [ ] 安装包能安装并启动 App。
- [ ] pi SDK 版本锁定。

## Dependencies
- electron-main, 全部功能模块。
