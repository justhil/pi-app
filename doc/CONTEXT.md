# pi-app 架构上下文（审计 / 重构用）

### 决策记录：侧栏项目固定顺序（2026）

侧栏项目列表默认按最近使用（MRU）排序：打开项目时 `configStore.addRecentProject` 把项目移到最前，且当前工作区始终置顶（`project-sidebar.tsx` 的 `diskPaths`）。新增配置项 `recentProjectsFixedOrder`（默认 `false`，保持 MRU 行为）：开启后 `nextRecentProjects` 不再移动已有项目（新项目追加到末尾），侧栏按存储顺序展示且当前项目不置顶（仅高亮）。纯函数：`src/main/recent-projects.ts`、`src/renderer/src/features/workspace/project-folder-order.ts`。设置页「最近项目」区开关直接写配置并派发 `pi-desktop:settings-changed` 事件通知侧栏即时重排。

**闪烁根因（勿回退）**：`ui-store.setWorkspace` 曾把当前工作区 unshift 到 `recentProjects` 最前——固定模式下侧栏先跳顶，随后 `reloadSidebarSettings` 从主进程拉回真实顺序——先跳再弹回 = 每次切换可见闪烁。修复：`setWorkspace` 不再重排 `recentProjects`（侧栏顺序以主进程配置为唯一事实源；MRU 模式由 `projectFolderOrder` 的“当前置顶”规则兜底即时显示）。另：`reloadSidebarSettings` 在顺序无变化时保持数组引用稳定，避免固定模式下每次切换都触发整个侧栏重渲染。
## 会话树交互术语（glossary）

- **查看跳转（view-jump）**：单击会话树节点，时间线非破坏性定位到该节点对应的消息。历史未加载时先触发只读补拉，加载完成后再跳转；不改变会话叶子、不回退、不打断用户输入。
- **回退（rewind）**：双击会话树节点或使用回退按钮，将会话当前位置移动到该节点（改变叶子，可再回退恢复）。
- **全局统一**：右栏会话树面板与双击 Esc 的会话树浮层交互一致：单击或 Enter=查看跳转，双击=回退。

### 决策记录：单击=查看、双击=回退（2026）

会话树曾两次被改错：`a34ffa2` 把单击改成仅选中（“点击没反应”），后续提交又把单击改成直接回退（破坏性）。正确语义：**单击/Enter=非破坏性查看跳转**（时间线定位到该节点，不改叶子、不打扰输入；未加载的历史只读补拉并增量合并，时间线始终代表真实最新）；**双击=回退**（navigateTree）。勿再改为“单击=回退”。

## 进程边界

| 进程 | 目录 | 职责 |
|------|------|------|
| Main | `src/main/` | 窗口、IPC、`config-store`、Worker 生命周期、sandbox 工作区 |
| Preload | `src/preload/` | `contextBridge` → `piDesktop`；`invoke` 仅允许 `packages/shared/ipc-channels.ts` |
| Renderer | `src/renderer/src/` | React UI；全局状态 `stores/ui-store.ts` |
| Worker | `src/worker/` | Pi SDK 会话；经 Main 桥接 |

## IPC 接缝（单一注册表）

- `src/main/ipc/registry.ts` — `registerHandler` / `sendEvent`
- `src/main/ipc.ts` — `registerAllHandlers()` 引导；逐步迁出内联 `registerHandler`
- `src/main/ipc/handlers/*` — 按域：`dialog`, `workspace`, `workspace-fs`, `session`, `prompt`, `settings`, …
- 契约列表：`packages/shared/ipc-channels.ts`（与 Main 注册必须同步，见 `scripts/tests/ipc-channel-sync.test.mjs`）

## 事件流

Renderer `piDesktop.onEvent` ← Main `sendEvent(win, AppEvent)` ← Worker。

- 类型：`packages/shared/app-events.ts`
- 会话守卫：`packages/shared/app-event-session.ts`
- 归约：`src/renderer/src/stores/apply-app-event.ts`（`ui-store` 调用，勿再把大段 switch 塞回 store）

## 安全默认值

- `src/main/window.ts`：`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 默认（`PI_RENDERER_SANDBOX=0` 可关；见 `doc/THREAT-MODEL.md`）
- Codex JWT：`src/main/secret-store.ts` + `asr-config-store.ts`（safeStorage，明文迁移）

## 质量门禁

- `npm run typecheck` — web + node
- `npm run test:scripts` — CI `quality.yml`
- `node scripts/ci-audit.mjs` — CI `dependency-audit`（critical 门禁）
- `doc/IPC-CONTRACTS.md` — IPC Backend-API 文档
- FMSM iter14 整改：**sandbox 默认 true**；`test:e2e`；CI `e2e-smoke` + `script-tests-win`；报告 `docs/audit/*iter14*`

## 严苛评分（FMSM 2026-07-01）

| 项 | 严苛分 | PRD 目标 |
|----|--------|----------|
| Overall | **8.0 A**（iter13：FMSM 整改 + PRD gates） | ≥8.0 ✓ |
| Testing | **7.4**（`scripts/tests` 29 文件，`fmsm-prd-gates` ≥27） | ≥7.0 ✓ |
| ipc **36**；ui-store **329**；apply-app-event **71**；worker/index **≤1100** 行；`as any` **≤22** | `worker-session-events` / `worker-timeline` / `worker-compaction-patch` 已拆 |

Trellis：`07-01-fmsm-remediate-a` 已归档 `archive/2026-07/`。威胁模型：`doc/THREAT-MODEL.md`（含 safeStorage）。
## composer 撤销 / 光标术语（glossary，2026 访谈确认）

- **原生编辑（native edit）**：浏览器自己执行的输入（输入法组合、原生 Shift+Enter、原生粘贴），参与 Chromium 的 contenteditable 撤销栈。
- **程序化插入（programmatic insert）**：JS 手动改 DOM（`insertTextAtCursor`、直接 `insertNode`、JS 调 `execCommand('insertText')`）——**会污染原生撤销栈**：之后按 Ctrl+Z 会把整个输入（含粘贴前输入的内容）整段清空。只有浏览器自己执行的插入可正常撤销/重做。
- **行首光标卡住（line-start caret stick）**：孤立 `<br>`（或 `<div>` 边界）之后的文本行开头，按 ← 键会把光标弹回本行末尾并卡住，永远到不了上一行。`<br>` 后紧跟一个 ZWSP（零宽字符）即可正常跨行——ZWSP 不显示、`serializeRichInput` 会剥掉。

### 决策记录：纯文本粘贴走浏览器原生插入（2026）

composer 曾对纯文本粘贴 `preventDefault` 后手动插 DOM——实测（真实 Chromium 回归脚本 `scripts/regression/composer-undo.mjs`）这会污染撤销栈：输入 "abc" 后粘贴 "hello world"，再 Ctrl+Z 会**清空整个输入**而非回到 "abc"。定案：**纯文本/富文本粘贴一律不拦截**（`useComposerAttachments.handlePaste` 只对文件/图片类 `preventDefault`），让浏览器原生插入保住撤销栈；富文本（Word/网页）来源的块级包装标签（div/p/li 等）由 `serializeRichInput` 按换行处理，不动 DOM 就不破坏撤销。**附件 chip 用 `execCommand('insertHTML')` 插入**（原生命令，可单独 Ctrl+Z 撤掉；jsdom 无 execCommand 时走手动兜底）。**Shift+Enter 同样改走原生**（不再手动插 br）。已知代价：图片+文字组合粘贴（chip+文本）仍为程序化插入，该组合的撤销不完美，属低频。

### 决策记录：所有 `<br>` 统一补 ZWSP 光标锚点（2026）

行首光标卡住的根因是孤立 `<br>`（来源：`renderRichTextFromPlain`/`renderRichFromSegments` 重建 DOM、原生 Shift+Enter、原生多行粘贴——原生多行纯文本粘贴实测插入单个含 `\n` 的文本节点，无 br）。定案：**新增 `anchorLineBreakCaret`（composer-editor-caret.ts），在两个 DOM 重建函数末尾 + rich-input 每次 input 事件后调用**（已带锚点的行跳过）。实测：粘贴后补锚点**不破坏**原生撤销（Ctrl+Z 仍只撤掉粘贴内容）。
