# Electron 主进程与安全配置

## Goal
搭建 Electron 主进程，配置安全底线、窗口管理、应用菜单和打包基础。

## Requirements
- nodeIntegration: false, contextIsolation: true, sandbox: true。
- preload 白名单 IPC API 暴露机制。
- 应用菜单（File / Edit / View / Window / Help）。
- 窗口生命周期管理（创建、聚焦、关闭）。
- electron-builder + NSIS 打包配置。
- electron-updater 依赖安装和框架代码（不要求第一版能自动更新，但框架就位）。
- OS 通知基础（Notification API）。

## Acceptance Criteria
- [ ] Renderer 无法访问 Node API（nodeIntegration 验证）。
- [ ] preload 只暴露白名单方法。
- [ ] 应用菜单可见且可操作。
- [ ] electron-builder 能打包出 Windows NSIS 安装包。
- [ ] OS 通知能弹出测试通知。

## Dependencies
- scaffold（需要项目结构）。
