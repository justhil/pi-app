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
## 外部会话同步术语（glossary）

- **外部更新（external update）**：非本 app worker 对会话 JSONL 的追加（典型：CLI 并发写同一会话）。app 空闲时**自动**把磁盘新尾部合并进时间线视图（不改变 worker 内存态）；同步状态由 composer 上方**三态指示器**呈现（见下）；完整手动刷新走右上角「刷新会话数据」按钮。

### 决策记录：外部更新走视图层只读合并，不重载 worker（2026）

CLI 与 app 同开一会话时，CLI 追加 JSONL。检测到外部更新后，app 只把磁盘新尾部合并进时间线视图（读路径 `session.getMessages` 本就磁盘直读、不依赖 worker），**绝不自动重载/覆盖 worker 内存态**——避免并发写互相覆盖与上下文丢失。监测机制：fs.watch 当前工作区会话目录（一个 watcher）+ 事件路由（命中当前会话→尾合并；新文件→刷新列表），切换会话只改路由；**定时轮询（~3s）兜底 Windows 丢事件**，另 debounce + 窗口聚焦时强制刷新。

### 决策记录：外部同步用三态指示器，不做发送前确认弹窗（2026）

实时同步已把磁盘尾部并入视图，弹窗冗余且打断输入。composer 上方**三态指示器**（`externalSyncPhase` 驱动）：外部写入合并成功 → **绿色脉冲「正在同步外部对话」**，约 5s 无外部写入自动隐藏（本轮结束）；IPC 同步异常 → **橙/红「外部同步异常」**，点击触发完整重载；空闲不渲染。**实现注意**：zustand `setState` 返回 `undefined`，判断"是否有新增"必须在 updater 内用局部变量捕获，不能靠返回值。

### TODO：实时思考过程同步（等待 pi 支持流式落盘）

pi CLI 的会话 JSONL 是**消息级落盘**（磁盘无流式中间条目，thinking+text+toolCall 同一条消息一次性 append）。因此 app 同步 CLI 会话的粒度上限 = 每条消息完成，CLI 思考过程中 app 看不到中间状态。**等 pi 支持思考块逐块落盘后**再回来做实时思考同步。勿再优化 watcher debounce/轮询间隔（那是消息级延迟，不是思考级）。
## 会话显示特性术语（glossary）

- **过程内容（activity item）**：时间线里非对话正文的条目——思考块（thinking）、工具调用行（tool-call，含命令执行）、skill 调用块。与对话正文（user/assistant 气泡）相对。
- **活动窗口（activity window）**：过程内容的滚动展开窗口，大小 N 可在设置中配置。默认折叠所有过程内容，仅**自动展开最新 N 个**；有新增过程内容时，超出窗口的最旧项回到折叠态。**用户手动展开/折叠优先于窗口**（窗口不强制折叠用户明确展开的项）。N=0 表示禁用窗口（保持纯手动行为）。整个时间线统一计数，不按回合分界。
- **元事件条目（non-message entry）**：`model_change` / `thinking_level_change` 等非消息 JSONL 条目。默认不展示；设置开关打开后，在时间线中以一行小字展示（如「切换到 acme/example-model · thinking: high」），相邻的 model+thinking 变更合并为一条。
- **skill 调用块（skill invocation）**：以 `<skill name="..." location="...">` 开头的独立用户消息（pi 把 skill 内容作为用户消息注入）。渲染为一行折叠摘要「调用 skill: <name>」，点击展开全文；**默认折叠、不受活动窗口 N 限制**；摘要层不显示 location 路径（含本机用户名，避免泄漏）。

### 决策记录：活动窗口与 skill/元事件展示（2026）

时间线可读性与信息容积的权衡：过程内容全展开则 AI 执行时刷屏，全折叠则看不到进展。定案：**默认折叠 + 滑动窗口自动展开最新 N 个 + 手动优先**（见 glossary「活动窗口」）；skill 调用块单独折叠（默认折叠、不受窗口限制）；元事件条目默认隐藏、开关可开。这三类均为纯展示层行为，**开关与 N 存放 app 私有 config-store，不进 pi settings**。

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