# Frontend Development Guidelines

> pi Desktop 前端开发规范。与 `docs/architecture.md`、`docs/frontend-design.md`、`docs/tui-replacement-and-adapters.md`、**`docs/adapter-layer-plan.md`** 并列，是前端实现的硬约束。
>
> **A/B/C 分层**：Composer `/` 联想、设置页 IA、扩展配置页都遵循该文档的 A/B/C 边界。
>
> **兼容层 v2（最高边界）**：App 本体除 pi 内核外**零具体插件专属代码**（含 trellis/ask）。Timeline / Config Host / 交互 Host **禁止 `if (id===...)` / `if (toolName===...)` 插件分支**，全部查 `adapter.json` 表。新增普通插件只写一个 JSON，不改 App 源码。权威文档 `docs/adapter-layer-plan.md`。

---

## Overview

pi Desktop 是一个基于 Electron + React 的 pi 桌面 GUI。前端气质定位为**工具型 Agent 工作台**：偏 VS Code / Linear / Agent 桌面 的克制工具感。

技术栈：React 18+ / electron-vite / Tailwind CSS 3+ / shadcn/ui (new-york + zinc) / Zustand / lucide-react / 系统字体栈（system-ui+Segoe UI+PingFang/Microsoft YaHei，不装 webfont）/ i18next + react-i18next。

**视觉实现**：对话区与动效以 **桌面 Agent UI 视觉 token + 交互模式** 为参考（非 Agent 桌面 全量对标）；调研见 `docs/ui-design-notes.md`。

---

## Skill 使用纪律（CRITICAL）

实现任何前端页面、组件、交互时，必须按以下规则调用 Skill。

### 必须调用的 Skill

| Skill | 何时调用 | 怎么用 |
|-------|---------|--------|
| **frontend-taste** | 写页面、组件、布局、动效、空状态前必读 | 质感方向，防 AI 模板感。不是清单打卡，是判断方向。 |
| **ui-ux-pro-max** | 做导航、表单、无障碍、触控尺寸、焦点环、交互状态时查规则 | 按 priority 1→10 查对应条目。 |
| **shadcn-ui** | 选组件、装组件、改 `components/ui` 时 | 用 CLI 或 MCP 获取组件源码，不手写一套 Button。 |

### 可选调用的 Skill

| Skill | 何时调用 |
|-------|---------|
| **taste-design** | 需要出一份 `DESIGN.md` 给设计工具/Stitch 对齐时。日常开发不必每次走。 |

### 禁止的做法

- 不调用 `frontend-taste` 就开始堆页面。
- 不调用 `ui-ux-pro-max` 就做表单/导航/无障碍。
- 不调用 `shadcn-ui` 就手写一套 Radix 组件。
- 为普通列表页调用 `image_gen`。
- 把 `taste-design` 和 `frontend-taste` 同时当硬约束叠满。以 `frontend-taste` + 本文档为准。

### Skill 调用顺序

```text
1. 读 docs/architecture.md 里和 UI 相关的章节
2. 读 frontend-taste（质感方向）
3. 查 ui-ux-pro-max 对应规则条目
4. 用 shadcn-ui CLI 安装需要的组件
5. 写代码
```

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Product Intent & Shell](./product-intent-and-shell.md) | 用户意图、三栏/顶栏/右栏、Composer 模型位、窗口三键 | **2026-06 沉淀** |
| [Timeline & Composer](./timeline-composer.md) | 流式、工具聚合/折叠、预览、上滑历史、斜杠、附件 | **2026-06 沉淀** |
| [Motion & Interaction](./motion-and-interaction.md) | **Hover/按压详表**、Composer/侧栏/消息/滚动条、keyframes、组件→类映射 | **2026-06 沉淀** |
| [Branding & Chrome](./branding-chrome.md) | icon.svg / PiMark / favicon / 打包图标 | **2026-06 沉淀** |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition, shadcn | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, IPC data fetching patterns | Filled |
| [State Management](./state-management.md) | Zustand UI state, AppEvent stream, IPC data | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, anti-slop | Filled |
| [Type Safety](./type-safety.md) | Type patterns, AppEvent, IPC contract validation | Filled |

### 改前端时的阅读顺序（推荐）

```text
1. product-intent-and-shell.md   # 别改错壳层与 Composer 职责
2. timeline-composer.md          # 对话区与工具展示
3. motion-and-interaction.md     # 动效类名与时长
4. component-guidelines.md + quality-guidelines.md
5. docs/frontend-design.md       # 长文设计与 Skill 纪律
```

---

**Language**: UI 文案通过 i18next key 调用，第一版中文。代码、路径、工具名保持英文原样。文档使用中文。
