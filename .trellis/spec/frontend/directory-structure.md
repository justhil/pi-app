# Directory Structure

> pi Desktop 前端目录结构和模块组织。

---

## Overview

前端代码在 `src/renderer/` 下，按 feature 分模块。和 Electron 主进程、preload、pi Worker 分离。

---

## Directory Layout

```
src/renderer/
  app/                 # app.tsx 三栏壳、RightPanelTabs
  features/
    workspace/         # 项目、会话列表
    timeline/          # timeline.tsx, markdown-view, tool-call-row, tool-group-summary,
                       # tool-card-templates, tool-previews, message-hover-actions, timeline-display-items
    review/            # Diff viewer
    trellis/           # 只读面板
    run/               # 运行摘要
    composer/          # 底部输入
    settings/          # General / Pi / Extensions / Resources / Diagnostics
  components/ui/       # shadcn + CollapsiblePanel 等，只放 CLI 生成/微调
  components/app/      # ImmersiveChrome, WindowControls, SessionRow…
  components/brand/    # PiMark 等品牌 SVG
  lib/
    ipc-client.ts      # typed IPC 调用
    app-events.ts      # AppEvent 类型定义
  styles/
    globals.css        # token + motion 变量
```

其它目录（不在 renderer 内，但前端会引用）：

```
packages/shared/
  ipc-contract.ts      # Renderer/Main/Worker 共享的 IPC 契约
  app-events.ts        # AppEvent 类型定义（四类：message/tool/file/run）
  schemas.ts           # zod 或 typebox 运行时校验
```

---

## Module Organization

### Feature 模块

每个 feature 目录包含：

- 该功能的页面/面板组件。
- 该功能的局部状态 hook。
- 该功能的 IPC 调用（通过 `lib/ipc-client.ts`）。

### 禁止的放置

- `components/ui`：不放业务逻辑，只放 shadcn 生成/微调。
- `components/app`：不放 shadcn 原始组件，放业务组合件。
- Extension 工具卡：走兼容层原语模板（`src/extension-compat/` 声明式 adapter.json + 预设模板 default/list/media/tree/kv），不放进 `components/ui`，也不在 `features/timeline/` 写插件名专属卡。
- Timeline 逻辑：不放进 `components/ui`。

### i18n 目录

```
src/renderer/
  locales/
    zh/
      common.json
      timeline.json
      review.json
      settings.json
    en/
      common.json
      ...
  lib/
    i18n.ts
```

---

## Naming Conventions

- 文件名：kebab-case（`tool-call-card.tsx`）。
- 组件名：PascalCase（`ToolCallCard`）。
- Hook 名：`use` 前缀（`useSessionList`）。
- IPC 方法名：camelCase（`session.list`、`prompt.send`）。
- AppEvent 类型：PascalCase + Event 后缀（`MessageEvent`、`ToolEvent`）。

---

## Examples

- 会话列表：`features/workspace/session-list.tsx`
- 工具卡：`features/timeline/cards/tool-call-card.tsx`
- Diff viewer：`features/review/diff-viewer.tsx`
- Trellis 只读面板：`features/trellis/trellis-panel.tsx`
- Run 摘要：`features/run/run-summary.tsx`
- 底部输入：`features/composer/composer.tsx`
