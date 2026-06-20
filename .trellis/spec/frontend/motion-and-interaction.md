# 动效与微交互规范（参考桌面客户端 对齐版）

> **Supersedes** `component-guidelines.md` 里 §动效 的时长默认值。实现以 **`src/renderer/src/styles/globals.css`** 为准（动效已内联在 `@layer base` + `@layer components` + `@layer utilities`，**不要**单独 import `motion-desktop-ui.css`，曾导致 PostCSS 失败）。

---

## 1. 用户意图

- 「参考 参考桌面客户端 **所有**动效」：数量、时长、缓动都要够，不能只有颜色 token
- 「淡出/侧栏收起/hover 选中」：**要能感知**，不能几乎静态
- 「hover 舒服」：**不等于**只有 hover——还有密度、默认折叠、语义动效、token 一致（见 quality-guidelines）
- **消息 hover 复制**：固定占位 + 只淡入，**禁止** hover 顶开正文（用户反馈「消息被抽出」）

---

## 2. Motion Token（当前实现）

```css
--motion-fast: 200ms;
--motion-normal: 280ms;
--motion-slow: 320ms;
--motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
```

| 硬编码时长 | 用途 |
|------------|------|
| **280ms** | `message-actions-slot` opacity |
| **360ms** | `panel-width-animate` width、`ui-enter` 入场 |
| **150ms** | `win-ctrl-btn` |
| **300ms** | `popover-rise`、`backdrop-fade`、滚动条 thumb 显色 |

`prefers-reduced-motion: reduce` → `--motion-*` 置 **0ms**（保留颜色/边框瞬时变化）。

---

## 3. 全局基础：所有可点控件的 hover 过渡

`@layer base` 对 **`button`、`[role="button"]`、`.interactive-row`** 统一：

```text
background / color / border → var(--motion-fast)
box-shadow → var(--motion-normal)
opacity → var(--motion-fast)
```

改新按钮时优先用上述标签或已有语义类（`chrome-icon-btn`、`row-hover`），避免无过渡的裸 `button`。

---

## 4. Hover 与按压 — 分类详表

### 4.1 消息区（Timeline）

| 元素 | 机制 | 类 / 组件 | 细节 |
|------|------|-----------|------|
| 复制 + 时间戳 | **React `hovered`**，非纯 `group-hover` | `MessageHoverShell` + `message-actions-slot` | 槽高 **32px** 常驻；`message-actions-slot-visible` → opacity 1 + pointer-events；**280ms** ease |
| 复制钮 | 图标钮微交互 | `chrome-icon-btn` on `MessageHoverActions` | hover `bg-hover`；active **scale(0.92)** |
| 工具单行 | 行 hover + 按压 | `row-hover` on `ToolCallRow` button | hover `var(--bg-hover)`；active **scale(0.98)** |
| 工具组标题 | 文案色 | `group-hover:text-foreground` | 折叠行摘要 secondary → foreground |
| 代码块复制 | CSS group | `group-hover:opacity-100` on `markdown-view` CodeBlock | 默认 opacity 0 |

**禁止**：用 `max-height` / `hover-reveal` 顶开消息正文。`hover-reveal`（translateY 8px + opacity）仅作备用，**消息行不用**。

### 4.2 侧栏与会话列表

| 元素 | 类 | hover / active |
|------|-----|----------------|
| 会话行 | `nav-row` + `sider-item-motion` | hover `bg-hover`；选中 `nav-row-active` + 左侧 **3px 品牌条** height 0→60%（**280ms**） |
| 会话行按压 | `sider-item-motion` | 可配合 `active:scale-[0.99]`（若 TSX 已加） |
| 侧栏项 | `SidebarItem`：`nav-row` + `sider-item-motion` | 同上 |
| 侧栏标签收起 | `sidebar-label-fade` | collapsed 时 max-width 0、opacity 0、**translateX(-6px)** |
| 宽度拖拽 | `panel-dragging` on `aside` | 拖拽中 **transition: none !important**（整棵子树） |

文件：`session-list.tsx`、`components/ui/sidebar.tsx`。

### 4.3 顶栏（ImmersiveChrome）

| 元素 | 类 |
|------|-----|
| 左/右栏图标 | `chrome-icon-btn` |
| 运行中徽章 | `animate-breathe`（**1.5s** infinite，opacity + 品牌 glow，**无 scale**） |
| 窗口三键 | `win-ctrl-btn`；关闭 hover **红底白字**（Tailwind `hover:bg-red-600`） |

### 4.4 右栏 Tab

| 元素 | 类 |
|------|-----|
| Tab 按钮 | `nav-row` + `row-hover` |
| 选中下划线 | `tab-indicator-motion`（transform/opacity/width **200ms**） |

文件：`app.tsx` → `RightPanelTabs`。

### 4.5 Composer

| 元素 | 类 | 状态 |
|------|-----|------|
| 输入外框 | `composer-shell` | 默认 border/bg **280ms**；**hover 未聚焦**：border 掺 brand 28%、背景 `bg-1` 混合 |
| 聚焦 | `composer-shell-focused` | `var(--focus-border)` + `var(--focus-shadow)` |
| 占位符 | `.composer-textarea::placeholder` | 聚焦时 opacity **0.55** |
| 模型/思考芯片 | `composer-pill` | hover border 掺 brand、浅 shadow；active **scale(0.97)**；打开 `composer-pill-open` + `composer-pill-active` |
| 发送钮 | `composer-send` | hover 轻 shadow；active **scale(0.96)**；运行中停止 **`animate-stop-breathe`**（1.4s alternate，aou 色 + 外扩 glow） |
| 斜杠 Popover | `popover-motion` | **popover-rise** 300ms，自底上 10px + scale 0.98→1 |
| 拖拽文件遮罩 | `backdrop-motion` | **backdrop-fade** 300ms |
| Model/Thinking Picker | `picker-backdrop` + `backdrop-motion` | 遮罩淡入；面板 **`picker-panel`**：**picker-scale-in** 280ms，translateY 8px + scale |
| Picker 列表行 | `picker-row` | hover `bg-hover`；active **scale(0.995)** |

文件：`composer.tsx`、`model-picker.tsx`、`thinking-picker.tsx`、`composer-pill.tsx`。

### 4.6 滚动条

| 状态 | 行为 |
|------|------|
| 默认 | thumb rgba 0.15 |
| 父级 `*:hover` | thumb 0.25 |
| thumb 自身 hover | 0.45 |
| 过渡 | background-color **0.3s** |

### 4.7 设置页 TopBar（非 ImmersiveChrome）

仍用 Tailwind：`hover:bg-accent`、`duration-motion-fast`、`active:scale-[0.93]`（与主壳 `chrome-icon-btn` 并存，后续可统一）。

---

## 5. 非 hover 动效（须与 hover 一并保留）

| 类 / 动画 | 时长 | 场景 |
|-----------|------|------|
| `panel-width-animate` | 360ms | 左/右栏宽度 |
| `expand-panel` + `CollapsiblePanel` | `--motion-slow` | 工具详情高度 grid 0fr→1fr |
| `chevron-expand[data-open=true]` | `--motion-fast` | 旋转 90° |
| `ui-enter` | 360ms | 消息块、工具行入场 |
| `stagger-1`…`5` | 40–200ms delay | 工具组展开子行（配合 `ui-enter`） |
| `animate-in` / `fade-in` / `slide-in-from-bottom-1` | `--motion-normal` | 通用块入场 |
| `slide-in-from-right` | `--motion-normal` | 设置子页等 |
| `shimmer-scan`（inline） | 2s linear | `ThinkingIndicator` 流式思考条 |
| `caret-blink`（inline） | 1.1s | `StreamingCaret` |
| `animate-spin` | 默认 | 工具 running `Loader2` |

---

## 6. 组件 → 样式 速查

```text
message-hover-actions.tsx     → message-hover-shell, message-actions-slot(-visible)
tool-call-row.tsx             → row-hover, chevron-expand, CollapsiblePanel/expand-panel
tool-group-summary.tsx        → ui-enter, stagger-*, group-hover:text-foreground
session-list.tsx              → nav-row, nav-row-active, sider-item-motion
sidebar.tsx (Left/RightPanel) → panel-width-animate, panel-dragging, sidebar-label-fade
immersive-chrome.tsx          → chrome-icon-btn, animate-breathe
window-controls.tsx           → win-ctrl-btn
app.tsx RightPanelTabs        → nav-row, tab-indicator-motion
composer.tsx                  → composer-shell(-focused), popover-motion, backdrop-motion
composer-pill.tsx             → composer-pill(-open|-active)
model-picker / thinking-picker → picker-backdrop, backdrop-motion, picker-panel, picker-row
tool-card-primitives.tsx      → shimmer-scan, caret-blink, animate-stop-breathe（composer 停止钮）
```

---

## 7. 性能（掉帧治理）

| 项 | 做法 |
|----|------|
| Timeline 列表行 | 用 **`timeline-message-row`**，**不用**每条 `ui-enter` / `stagger` |
| 滚动通知 | `timeline-scroll` 经 **`rafThrottle`**；进度条 **rAF + transform**，禁止 `setInterval` |
| 空白区滚轮 | `scrollTimelineByDelta` **rAF 合并** wheel delta |
| 侧栏宽 | 拖拽时 **`panel-dragging`** 关过渡；避免同时 anim width + 长列表 repaint |
| 工具折叠 | **`expand-panel`** 不做 `grid-template-rows` 过渡（瞬时展开） |
| 思考中 | **`animate-thinking-pulse`**（opacity），不用 `background-clip` 无限 shimmer |
| 滚动容器 | **`timeline-scroll-viewport`**：`overscroll-behavior: contain` |

## 8. 禁止

- 侧栏收起 **`key` remount** 打断 `panel-width-animate`
- 拖拽宽度时不开 `panel-dragging`
- 消息复制用 max-height 挤布局
- bounce / elastic；侧栏与 Timeline **同时**长段动画
- 三栏拖动中用 width **动画**跟手
- 每条工具卡 infinite shimmer（仅思考条/停止钮等语义处可用）

---

## 8. 改 CSS / 动效后

- 只改 **`globals.css`** 内联层，勿恢复独立 `motion-desktop-ui.css` import
- 改 `main/window.ts` → **重启 Electron dev**
- 新增 hover 时：先查本节 **§4** 是否已有同类，避免重复一套时长

---

## 9. 与 timeline-composer 的交叉引用

- 工具默认折叠、聚合、流式：**`timeline-composer.md`**
- 消息 hover 固定槽：**`timeline-composer.md` §1.6** + 本文 **§4.1**