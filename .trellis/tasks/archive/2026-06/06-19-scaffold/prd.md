# 项目脚手架与构建配置

## Goal
初始化 pi Desktop 的 Electron + React + TypeScript 项目，配置构建工具链和设计基础。

## Requirements
- Electron + electron-vite + React 18 + TypeScript 项目初始化。
- 目录结构按 architecture.md §7 和 spec frontend/directory-structure.md。
- Tailwind CSS 3+ 配置，CSS 变量 design token。
- shadcn/ui (new-york + zinc) 初始化，安装首批组件清单。
- Geist Sans + Geist Mono 字体集成。
- Motion token CSS 变量定义（globals.css）。
- packages/shared 目录创建。
- lucide-react 安装。
- Zustand 安装。

## Acceptance Criteria
- [ ] `npm run dev` 能启动 Electron 开发模式。
- [ ] Renderer 能渲染一个空白三栏布局壳。
- [ ] Tailwind + shadcn Button 能正常渲染。
- [ ] Geist 字体加载成功。
- [ ] Motion CSS 变量在 :root 和 prefers-reduced-motion 中定义。
- [ ] 目录结构和 spec frontend/directory-structure.md 一致。

## Dependencies
- 无（阶段一基础任务）。
