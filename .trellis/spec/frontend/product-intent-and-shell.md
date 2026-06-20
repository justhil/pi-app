# 产品意图与主壳规范

> 沉淀 2026-06 多轮 UI 打磨中的**用户意图**与**已落地决策**。改主布局、顶栏、侧栏、右栏前必读。
>
> 并列参考：`docs/frontend-design.md`、`docs/ui-design-notes.md`、`.trellis/spec/frontend/motion-and-interaction.md`

---

## 1. 产品定位（用户原话约束）

| 意图 | 含义 | 实现约束 |
|------|------|----------|
| **pi 的新壳** | 不是聊天套壳，是 **TUI 的桌面替代** | A/B/C 分层见 `docs/tui-replacement-and-adapters.md`；App 本体零插件专属渲染，走 `adapter.json` |
| **贴近 Agent 桌面** | **长期方向**，非 v0 全量对标 | 借鉴分区与 Composer 信息密度；不一次性抄全功能 |
| **审美与舒适** | 「尽可能美观优雅」「字体刺眼要修」「动效要像成熟产品」 | 参考 **桌面 Agent UI / 跨端客户端** 的**视觉与动效**，不复刻业务逻辑；clone 仅放临时目录调研 |
| **沉浸主对话** | 少 chrome、少装饰头像 | 主界面 **无厚重 TopBar**、**无助手轮次左侧 Bot 头像**、无边框窗口 |

---

## 2. 三栏与宽度（已敲定）

| 区域 | 规则 |
|------|------|
| **中间列** | 外层 `flex-1 min-w-0` **占满**左右侧栏之间的空间 |
| **对话内容区** | `.chat-content-column` 居中；**非固定 780px**：`<768px` 满宽（同 桌面 Agent UI `max-w-full`）；`≥768px` 为 `clamp(min(560px,100%), 72%, min(1280px,100%))` — **随中间列可用宽度比例伸缩**，大屏可宽于 780；变量 `--chat-content-min/ratio/cap` 在 `globals.css` |
| **左栏** | 默认 **260px**，拖拽 **200–360px**；**收起 = 宽度 0，不渲染**（无窄条图标轨），顶栏 `PanelLeft` 再展开 |
| **右栏** | 默认 **288px**，拖拽 **240–420px**；**收起 = 不渲染**；对话区右上角 `MainColRightPanelToggle` 展开；收起时滚动条 `ChatTimelineProgressRail` 贴主列右缘 |
| **右栏收起按钮** | **`MainColRightPanelToggle`**：浮在**中间列右上角**（对话区右上），不占右栏单独一行 |
| **聊天滚动进度条** | **`ChatTimelineProgressRail`**：贴在**中间列右缘**（右栏左侧），全高，不随 `chat-content-column` 居中；点击轨道跳转 |
| **右栏拖拽条** | **`right-panel-resize-edge`**：6px 竖条贴在右栏**左缘**（主区与右栏之间），hover/拖拽时品牌色提示 |

---

## 3. 顶栏与窗口（ImmersiveChrome）

### 3.1 主对话页

- 组件：`src/renderer/src/components/app/immersive-chrome.tsx`
- 高度约 **36px**（`h-9`），`electron-drag` 可拖拽；按钮区 `electron-no-drag`
- 左侧：左栏开关（`PanelLeft`）、`PiMark` + `pi` + 可选 `项目名`
- 右侧：运行状态（`animate-breathe` / 就绪）、**右栏收起**（`PanelRight`）、**窗口控制**（仅 Win/Linux）

### 3.2 设置页

- 仍用 **`TopBar`** + 返回，不用 ImmersiveChrome

### 3.3 无边框与菜单

- `src/main/window.ts`：Win `frame: false`；macOS `titleBarStyle: hiddenInset`
- Win/Linux：`Menu.setApplicationMenu(null)`（用户要求去掉 File/Edit/View 顶栏菜单）
- macOS：保留最小 App/Edit/Window 菜单（系统惯例）

### 3.4 窗口三键（Windows / Linux）

- IPC：`ipc:window:minimize` | `maximize` | `close` | `isMaximized`（`src/main/window-controls.ts`）
- UI：`WindowControls`；关闭键 hover **红底白字**
- **macOS 不渲染**三键（系统交通灯）

---

## 4. 右栏职责（用户纠偏）

| Tab | 应有 | 不应有 |
|-----|------|--------|
| **Review** | turn/session/git diff，真实 `fileChanges` + `review.getDiff` | — |
| **Trellis** | 扫描 `.trellis/tasks/` 多任务卡片、journal 摘要 | 仅 `task.py current` 单条 |
| **Run** | 运行阶段、工具状态行 | **模型/思考等级切换**（已迁到 Composer） |
| **Context / Intercom** | 只读预览 | 写 Trellis / 改任务 |

---

## 5. 模型与思考等级（Composer 权威）

- **展示与切换**在 **Composer 底栏**（Agent 桌面 式可点芯片 + Picker），**不在 RunPanel**
- `/model`、`/thinking` **无参数**时打开 **ModelPicker / ThinkingPicker**（可搜索、可见当前值），**禁止**静默 cycle 让用户不知道当前模型
- 状态同步：`RunEvent` + Worker `getState` + `session_info_changed` / `thinking_level_changed`；`ui-store` 的 `lastModel` / `lastThinking` **persist**，切会话 **`loadHistoryItems` 时恢复**，避免 Composer 底栏空白
- 模型列表权威：`Worker getModels` / `model.list`，**禁止** Main 空 Registry 当唯一源

---

## 6. 品牌与图标

- 源：`resources/icon.svg`（用户可手改）；同步 `src/renderer/public/icon.svg`、`PiMark`、 `npm run icon:export` → `build/icon.png`
- 顶栏小标：`components/brand/pi-mark.tsx`（与 SVG 同源；主题用 `fill-foreground` / `fill-background`）
- 图标 co-design 约束（用户）：**黑白**、有设计感、**π + justhil** 隐性融合——属品牌迭代，不阻塞功能开发

---

## 7. 改壳时的检查清单

- [ ] 对话是否仍在 `chat-content-column`（780px 居中），中间列外层仍 flex-1？
- [ ] 侧栏收起是否未 remount 打断动画？
- [ ] 右栏收起是否在 ImmersiveChrome（非 Tab 行）？
- [ ] 模型/思考是否只在 Composer？
- [ ] macOS 是否未画 Win 三键？
- [ ] 设置页是否仍用 TopBar 返回？