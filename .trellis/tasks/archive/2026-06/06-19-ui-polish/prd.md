# 前端 UI 打磨：字体 / 动效 / 流式 / 状态记忆 / 设置 / 拖拽

**定位**：在 `architecture.md` 保守第一版范围内，把当前「能用但粗糙」的 UI 打磨成接近 Agent 桌面 / 跨端客户端 / 桌面 Agent UI 的成熟 agent 工作台质感。不改产品范围，只做视觉与交互打磨。

---

## 背景（当前问题，侦察确认）

| 问题 | 根因（已核实） |
|------|----------------|
| 字体看着眼睛疼 | `src/renderer/src/styles/globals.css` **完全没设 `font-family`**，全靠 Tailwind 默认（Windows 上是系统雅黑）。已敲定走系统字体栈（不装 webfont），尚未落地 |
| 动效太死板 | 只有 `fade-in`/`slide-in`，assistant 状态就三个 `animate-pulse` 圆点 |
| 流式效果差 | assistant 出字无打字感、无增量平滑过渡 |
| tool result 太重 | 工具结果默认展开占大量空间，无「淡化小字可折叠」 |
| 状态记忆丢失 | `ui-store.ts` **完全没 persist**（无 localStorage / zustand persist）；model/thinking 是 `runState` 被动字段，切会话被 run 事件覆盖丢失 |
| 设置界面局促 | 宽度/元素尺寸/交互逻辑未经打磨 |
| 无文件拖拽 | Composer textarea 只有 `onPaste`，**无 `onDrop`/`onDragOver`** |

---

## 范围与子任务拆分

1 个父任务 + 设计基线，4 个独立可验证子任务。

| 子任务 | 范围 | 依赖 |
|--------|------|------|
| `ui-fonts` | 系统字体栈（不装 webfont）+ 中文 fallback + mono 栈；全局落地 | **无**，P0 先做，全局基础 |
| `ui-state-memory` | ui-store 加 zustand persist；model/thinking 跨会话记忆；picker 选值主动落盘；其他 UI 状态（侧栏宽/面板/最近项目）持久化 | **无** |
| `ui-settings-composer` | 设置页宽度/布局/元素尺寸重做；补 pi 原生设置项；Composer 文件拖拽 → 自动渲染为整块 chip | **无** |
| `ui-timeline-polish` | tool result 淡化小字可展开/折叠；流式打字效果；整体动效美化（入场/过渡/微交互） | **依赖 adapter-layer-v2 Phase A+B**（在硬编码工具卡分支上做美化是返工）|

---

## 依赖关系（硬约束）

```
adapter-layer-v2 (Phase A 骨架 + Phase B pi-search)
        │
        └─► ui-timeline-polish  （tool result 渲染走原语后再美化）

并行先行（不依赖兼容层）：
  ui-fonts / ui-state-memory / ui-settings-composer
```

> 用户明确：兼容层先完善好，方便直接开始。即 timeline-polish 等 adapter-layer-v2 的工具卡原语就绪后开工，避免在 `if(isPiSearchTool)` 硬编码分支上做返工美化。其余三个子任务无依赖，可立即开工。

---

## 设计参考（调研方法）

参考项目：Agent 桌面（OpenAI codex CLI/GUI）、跨端客户端、桌面 Agent UI 等。

**调研纪律**：
- 仓库 clone 到**系统临时目录**（`os.tmpdir()`，如 `D:/tmp/pi-ui-refs/`），项目外，**零污染**，不需 gitignore。
- 提取：字体栈、字号阶梯、动效曲线/时长、流式实现方式、拖拽整块渲染模式、设置页布局、工具结果折叠交互。
- 不抄代码，只提取**设计 token 与交互模式**，落到本任务 `design.md`。
- 调研产物作为子任务的实现依据，不进 git。

详见 `design.md`。

---

## 实现纪律（强制调用前端 Skill）

实现任何子任务前必须（见 `.trellis/spec/frontend/index.md`）：

1. 读 `frontend-taste` skill（质感方向，防 AI 模板感）。
2. 查 `ui-ux-pro-max` 对应条目（accessibility / touch / forms / animation）。
3. 用 `shadcn-ui` CLI 获取组件，不手写 Radix 套件。
4. 需要出方向时可走 `taste-design` / `frontend-designer`，但日常开发以 `frontend-taste` + 本 spec 为准。

禁止：不调用 Skill 就堆页面；手写一套 Radix 组件；为普通列表调 `image_gen`。

---

## 验收标准（DoD，父级）

1. `npm run build` 三目标全绿，无新增 ReferenceError / type error。
2. 字体：全局生效系统字体栈，中英文/代码清晰不刺眼（对照截图前后）。
3. 动效：流畅不卡顿，`prefers-reduced-motion` 降级生效，无「整个应用在晃」感。
4. 流式：assistant 出字有自然增量过渡，非突变。
5. tool result：默认淡化小字单行，点击展开详情；占用空间显著降低。
6. 状态记忆：切换会话/重开 app，model + thinking + 面板宽度 + 侧栏状态不丢。
7. 设置：宽度合理、元素尺寸规范、含 pi 原生设置项（thinking steer/compaction/sessionDir 等可写的）。
8. 拖拽：文件拖入 composer 自动渲染为整块 chip（路径/类型/可移除），发送时带上文件路径。
9. 全程未在 `src/`（除 `src/extension-compat/`）引入新插件名分支（兼容层 v2 边界，见 `docs/adapter-layer-plan.md`）。

---

## 相关文件

- 样式：`src/renderer/src/styles/globals.css`
- 状态：`src/renderer/src/stores/ui-store.ts`（无 persist，待加）
- Composer：`src/renderer/src/features/composer/composer.tsx`、`model-picker.tsx`、`thinking-picker.tsx`
- Timeline：`src/renderer/src/features/timeline/timeline.tsx`（依赖兼容层重构）
- 设置：`src/renderer/src/features/settings/settings-page.tsx`
- 设计约束：`.trellis/spec/frontend/*`、`docs/frontend-design.md`
- **UI 参考研究**：`docs/ui-design-notes.md`（跨端客户端/桌面 Agent UI 调研，含子任务映射）
- **参考项目**（临时目录，长线任务被清理可重新 clone）：`D:/tmp/pi-ui-refs/{跨端客户端,桌面 Agent UI}`

---

## 状态

- [x] 设计基线 design.md（调研 + design token）
- [x] ui-fonts
- [x] ui-state-memory
- [x] ui-settings-composer
- [x] ui-timeline-polish（等 adapter-layer-v2）
