# ui-state-memory：UI 状态记忆持久化

父任务：`06-19-ui-polish`（见 `prd.md` §4 + `design.md` §4）。无依赖。

---

## 问题
`src/renderer/src/stores/ui-store.ts` 完全没 persist（无 localStorage / zustand persist 中间件）。model/thinking 是 `runState` 被动字段（从 run 事件来），用户在 picker 手选后切会话/重开 app 全丢。

## 范围
1. ui-store 加 zustand `persist` 中间件，`name: 'pi-desktop-ui'`，存储 `localStorage`。
2. **partialize 白名单**（只持久化这些，其余不持久）：
   - 侧栏宽度、面板宽度
   - 主题（light/dark）
   - `lastModel`、`lastThinking`（picker 最近选择）
   - 最近项目列表
   - 面板开关/激活面板
3. **不持久化**：`runState`（实时态）、timeline messages（事实来源在 Worker session JSONL）、picker open 状态、loading 标志。
4. **model/thinking 记忆逻辑**：
   - `model-picker.tsx` / `thinking-picker.tsx` 选值时，除调现有 IPC（`model.set` / `thinkingLevel.set`），写 `lastModel` / `lastThinking` 到 store（持久化）。
   - 切会话（`loadSession`）后：run 事件若带 model/thinking 用它，**否则回退 `lastModel`/`lastThinking`**，不再丢。
   - 新会话默认用 `lastModel`，而非每次重选。
5. 确认 Worker `model.set`/`thinkingLevel.set` 对 `sessionId=''` 的语义（全局 vs 会话级），记忆策略与之对齐。

## 边界
- 不持久化实时态/会话内容。
- 不改 IPC 契约，只在前端 store 层加记忆。
- session 事实来源始终是 Worker，前端 store 记忆仅是 UI 默认值。

## 验收
1. `npm run build` 绿。
2. 选 model=claude-xxx + thinking=high → 切到另一会话 → 仍显示 claude-xxx / high（不丢）。
3. 关 app 重开 → lastModel/lastThinking + 侧栏宽 + 主题 保留。
4. `runState` 不进 localStorage（DevTools 检查，避免膨胀）。
5. partialize 白名单准确，无多余字段。

## 参考与设计依据

- 父任务 `design.md` §0：参考项目目录（`D:/tmp/pi-ui-refs/{跨端客户端,桌面 Agent UI}`）与文件索引。
- `docs/ui-design-notes.md` §7（主题防闪烁）：桌面 Agent UI 的 `index.html` 内联同步脚本，在 React 加载前从 localStorage 读 theme 预设 `data-theme`，防首屏 FOUC。本任务做主题记忆时应配套加这个防闪脚本。
- `docs/ui-design-notes.md` §3（侧边栏宽度钳制）：跨端客户端 `MIN_CHAT_WIDTH=400`，拖动时约束各栏最小宽度。
- 直查源码：`桌面 Agent UI/.../renderer/index.html`（防闪内联脚本）。

## 实现纪律
读 `.trellis/spec/frontend/state-management.md`；zustand persist 用 partialize 精确控制。
