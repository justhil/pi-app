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
## 对话文件汇总术语（glossary）
- **对话文件汇总（turn file summary）**：每个已完成回合保留的改动文件卡片。单击文件行在卡片内展开或收起该回合的**最终净 diff**；文件行同时提供打开文件、复制路径和进入 Git Review 的独立操作。
- **回合文件基线（turn file baseline）**：某文件在本回合第一次修改之前的内容状态。回合结束后用最终文件状态与该基线比较，生成最终净 diff；中间多次编辑默认不展示。
- **最终净 diff（final net diff）**：文件回合结束状态相对于回合文件基线的差异。它不等同于当前工作区相对 `HEAD` 的 Git diff，也不展示本回合内已被后续编辑抵消的中间变化。
- **汇总路径操作（summary path actions）**：文件汇总中面向路径的快捷操作。默认复制绝对路径；复制工作区相对路径、在文件夹中显示等低频操作放在二级菜单。
### 决策记录：回合最终净 diff 用 Worker 内存基线结算（2026）
每个已完成回合保留文件汇总卡片；单击文件行展开该回合的**最终净 diff**。实现：Worker 在 edit/write/insert 等可提取路径的修改工具**执行前**读原文件建基线（每文件每回合首次为准，只放内存、不写临时文件、不写会话 JSONL），`turn_end` / `agent_settled` 时读最终文件，用 `diff` 库生成 unified diff 发出 `turn_diff` 事件；成功/失败/中止都结算，净零变化不产出条目。**持久化**：基线不持久化（进程周期内有效）；结算后的 diff 文本由主进程写 app 私有数据目录 `userData/turn-diffs/`（每会话最多 50 条），重启后由 `session.getTurnDiffs` 恢复——不写会话 JSONL。限制：单文件快照上限默认 1 MiB（设置 0–16 MiB，0=关闭，Worker 初始化时读取、重启生效）、二进制不缓存、超出工作区不缓存、每回合预算 = 单文件上限×16 封顶 64 MiB、diff 文本 256KB/3000 行截断；未缓存文件在卡片中给出原因（超限/二进制/工作区外/不可读/预算）。**匹配链**（精确→降级）：turnId → runId → 回合序号（Worker 每个 turn_start 占号，与视图回合序号对齐）→ 仅视图最后一个已完成回合允许用该会话最新记录兜底。**无净 diff 记录的回退**：用回合工具记录（JSONL 自带的 edit/write 参数）渲染逐操作 diff（标注「来自工具记录」）；连工具记录都没有时行点击直接打开文件。**结算必须等待本回合在飞捕获完成**（pendingOps 计数），否则 turn_end 早于 stat/read 完成时会静默丢 diff。中间逐操作过程不另建界面（时间线工具行已有）。
### 决策记录：右栏导航用 store 意图，不再依赖瞬时 CustomEvent（2026）
Review / Files 面板是懒加载组件；先切面板再同步派发 CustomEvent 时，事件会在面板挂载前丢失（"点击无反应"根因）。改为 ui-store 中的一次性导航意图（panel + scope + path + seq），面板挂载后用模块级已消费 seq 消费一次（防卸载重挂重复消费），同时保留 CustomEvent 作为已挂载时的即时通道（双通道幂等）。Review 打开时统一切到 git scope（该 scope 才有真实 diff；turn/session scope 只有文件元数据）。**三个坑（勿回退）**：
1. `React.StrictMode` 双跑 effect 时，Files 面板的 `resetTabs()` 挂载 effect 会把意图 effect 刚打开的文件清掉——挂载首跑必须跳过 reset（用 ref 记录已见 workspaceRoot）。
2. `FileDiffView` 的展开态是 `useState(defaultOpen)` 只在挂载时生效——面板已挂载时新焦点请求必须用 focusToken 递增触发 effect 重新展开。
3. `parseGitStatus` 不能对整串 `trim()`：porcelain v1 第一行的行首状态空格会被吃掉，第一个未暂存文件（`' M path'`）路径残缺（`rc/...` 样式）永远匹配不上焦点路径，表现为「点击某文件的 git review 无效」。按行清洗（仅去 `\r`），保留行首状态列。

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

## 路线图共识术语（glossary，2026-08-14 访谈确认）

- **pi-app 定位**：用户友好、可靠的界面；底层能力与功能扩展依赖 pi 生态（不在 app 内另造内核或工作流）。相对其它社区 pi UI，选择 pi-app 的理由 = 友好可靠 + 完整生态兼容。
- **双线（已确认定义）**：pi TUI 自身即极客线；pi-app 承担桌面主流线。pi-app 路线图只覆盖桌面主流线，TUI 改进不属本仓库排期（必要时仅作上游依赖追踪）。
- **优先级**：桌面体验是首要任务；工作流功能复用 pi 生态，不预装官方包。
- **迭代节奏**：基础体验周更；大功能 1–3 个月周期迭代。
- **否决记录（第二轮）**：「官方工作流包（batteries-included，plan/todo/cost 预装）」被否决——复用 pi 本身的扩展基建，改为 UI 化插件管理（搜索/安装/卸载，候选待确认）。
- **移动端（C1）**：排在桌面大功能（G3/G4）之后、推广（G5）之前（2026-08-14 调整）；参考 orca；桌面线稳固后启动评估。
- **存量治理（R0）**：对现有功能做 review / rethink / 精简 / 修复，路线图最高优先，先于一切新功能。首轮盘点产物：`doc/R0-FEATURE-REVIEW.md`（清单 + 13 个重叠热点 + 三档精简建议）。
- **双轨道骨架**：轨道 1「周更打磨轨」（G1 桌面体验连续小项，每周发版）+ 轨道 2「大功能轨」（G2 插件管理 UI → G3 会话树深化 → G4 多会话并行/subagent 面板化，1–3 个月/项）；之后 C1 移动端；G5 推广为最后一项；里程碑 M1/M2/M3 是验收点而非硬排期。
- **非目标（明确不做）**：权限审批弹窗（已移除，坚持事后审查）、官方预装包（已否决）、MCP 官方包（归社区）、TUI 上游改造（pi-mono 极客线）、app 内另造内核/与 CLI 数据分叉。
- **执行方式**：模型辅助快速迭代开发；周更轨小改动快速回归，大功能轨 1–3 个月立项迭代。
- 完整路线图见 `doc/ROADMAP.md`（2026-08-14 共识定稿）。
- **路线图语言要求**：`doc/ROADMAP.md` 面向普通人，讲人话、无行话黑话，宁可啰嗦。
- **基建服务插件**：pi-app 已有的基建能力（展示/交互原语）以通用组件形式服务插件（例：schema 驱动的配置表单，下拉框代替手填 JSON 字段）；约束：核心必须保持精简、可维护、不臃肿——原语必须通用可复用，禁止为单个插件写专用代码。
- **G2 范围（2026-08-14）**：插件管理界面 = 搜索/安装/卸载 + 配置表单；明确**不做**「任意 JSON 文件通用编辑器」（无 schema 做不了下拉框，属范围蔓延）。
- **配置表单实现约束**：字段说明放 adapter 配置（沿用 builtin/用户/项目三层覆盖），不改 npm 包；写回走 pi SDK 设置语义（合并+锁），与终端版不冲突；先静态 schema MVP，动态选项后置。
- **M2 拆两段**：先搜索/安装/卸载（1 个月内），后配置表单（随后 1–2 个月）。
