# 多开并行工作台 · 架构设计

> 与 [architecture.md](./architecture.md) 互补：本文是 **多 pane / 多 Worker 真并发** 的架构全景、ADR、数据流与演进路线，属产品长期路线独立项，分阶段（P-A/B/C）推进，**不绑定具体版本号**。
> 评审基线见 [architecture-review.md](./architecture-review.md)（曾把「单 Worker 单 cwd — 多会话并发弱」列为头号死穴，标为成熟期）。本文记录：**由用户产品诉求触发，提前进入架构推进**。

---

## 一句话定位

在「单 Worker 单会话焦点」基线上，交付 **多 pane 终端式分窗 + 多 Worker 进程池真并发**：用户可在中心区域无限二叉分窗，每个 pane 绑定一个 session 并真正并行跑 agent turn；同项目多 session 与跨项目多 workspace 均真并发。

---

## 背景与触发信号

| 维度 | 现状（单焦点基线） | 多开并行目标 |
|------|---------------|-----------|
| Worker 模型 | 全局单例 `workerManager`，一进程一 session，`session.prompt()` 串行 await | 多 Worker 进程池，一 session 一 worker 进程，真并发 |
| 前端布局 | 单焦点对话区 + 侧栏 + 右栏 | 中心区递归二叉分窗，N 个 pane，终端式 |
| 事件路由 | 单 `AppEvent` 流直送唯一 `mainWindow` | `AppEvent` 带 `sessionId`，按 `sessionKey` 多路分发到对应 pane |
| 状态 | `ui-store` 单焦点 timeline + 单 Composer | 按 `sessionKey` 分片的 `PaneStore` × N + 全局布局树 |

**触发升级的信号**（对照 `architecture-review.md`「升级架构必须由信号触发」）：
- 用户产品诉求：成熟产品（终端 tmux、IDE 分窗）已验证「多开并行工作」是高频心智，单焦点是体验瓶颈。
- `architecture-review.md` 已将「单 Worker 单 cwd」标为**头号死穴**，仅推迟到成熟期。现由诉求提前推进。
- 非技术驱动、非规模告警——是**产品方向决策**，故以 ADR 形式记录并进入长期路线。

> ⚠️ 与旧基线冲突：旧规划曾明确「桌面仍为单 Worker 单会话焦点」。本架构**推翻该约束**，多开并行成为长期路线一等公民。

---

## 核心 ADR（架构决策记录）

### ADR-1 · Worker 模型 = 多进程池（一 session 一 worker 进程）

- **背景**：`worker-manager.ts` 是全局单例 + 单 `worker` 实例 + 单 `currentCwd`。单进程内虽可实例化多 `AgentSession`，但共享 MCP 连接、扩展状态、provider 客户端、文件锁，并发风险高且 SDK 并发未经验证。
- **候选**：A 单 Worker 多 session 并发（省进程，共享态风险高，一崩全挂）；B 多 Worker 进程池（进程级隔离，崩溃互不影响）。
- **决定**：**B — 多 Worker 进程池**。一 session 一 `utilityProcess.fork`。
- **代价**：每 worker ≈ 60–100MB；并发上限受单机内存/CPU 约束（估算 4–6 路触顶）；`worker-manager` 需从单例重写为池（生命周期/启停/资源上限/崩溃恢复/事件多路）。
- **触发信号**：本决策即触发，无需等待规模告警。

### ADR-2 · pane = session 对话视图（终端式）

- **背景**：终端分窗里一个 pane = 一个 shell。pi 桌面有对话/设置/diff/上下文多种面板，pane 装什么决定布局-视图模型复杂度。
- **决定**：**一个 pane = 一个 session 对话**（Timeline + Composer）。分窗是「多开 session 视图容器」，不是任意面板容器。
- **代价**：设置/diff/上下文等面板不进 pane，仍走侧栏/右栏/全屏（保持现有壳层）。
- **非目标**：pane 承载任意视图（会引入布局-视图解耦、视图注册表、每 pane 状态切片，复杂度显著上升，留待后续）。

### ADR-3 · 事件多路复用：AppEvent 全带 sessionId，按 sessionKey 路由

- **背景**：现 `AppEvent` 直送唯一 `mainWindow`，单焦点。多 pane 并发时事件必须定向。
- **决定**：所有上行 `AppEvent` 携带 `sessionId`；Main 侧 `EventRouter` 按 `sessionKey`（`sessionId` 归一化句柄）分发到对应 pane 的 `PaneStore.timeline`。
- **代价**：`app-events.ts` schema 扩字段；Worker 上行事件必须带 `sessionId`；Renderer 不再全局订阅单一流，改为按 pane 订阅。

### ADR-4 · 分窗 = 递归二叉分割树，叶子 = pane = session 句柄

- **背景**：终端式无限分隔。
- **决定**：布局为递归二叉树；内节点 = 分割方向（水平/垂直）+ 比例；叶子 = pane，持 `sessionKey`。支持 split / resize / close / focus。
- **代价**：需布局引擎 + 持久化 + 恢复；最小 pane 尺寸需设下限防退化。

### ADR-5 · 跨项目 + 同项目均真并发（全维度真并发，不留串行降级路径）

- **背景**：用户明确要求全维度真并发，反对「同项目视觉多开/排队」的降级。
- **决定**：架构按全维度真并发设计。同项目多 session 各起 worker 真并发；跨项目天然多 worker。
- **代价 / 待验证风险**：同项目多 worker 同时写同一 `.pi` 目录的并发工具（edit/bash/insert）需确认无文件锁竞争；多 worker 并发调用同一项目 `.pi` 下的扩展/MCP 可能竞争。**P-B 验收必须覆盖此场景**。
- **演进**：实现分阶段（见演进路线），每阶段均为真并发，仅范围扩大，**不引入串行降级**。

### ADR-6 · 并发软上限 + 警告 + idle 回收（安全网）

- **背景**：用户选「软上限 + 警告」（超限警告但仍允许起 worker）。
- **决定**：软阈值（如 4），超过时 UI 警告但允许 acquire；**配套 idle 回收**（一段时间未用或内存压力时杀 worker 释放）作为安全网。
- **代价 / 诚实标注**：纯软上限无兜底 = 资源失控，桌面卡死。**idle 回收是软上限的必要补丁，不是可选**。回收策略需防「用户想看的历史 pane 被误杀」——回收仅杀非焦点且无 active turn 的 worker，pane 保留为冷视图（重激活时重新 acquire + 重载历史）。

---

## Context（系统边界）

```text
                    ┌─────────────────┐
                    │  用户 / 开发者   │
                    └────────┬────────┘
                             │ 多 pane 并行交互
┌────────────────────────────┼────────────────────────────┐
│  pi Desktop (本应用)       │                            │
│  ┌──────────┐  IPC(多路)  ┌┴─────────────┐  fork × N   │
│  │ Renderer │◄───────────►│ Main          │◄──────────►│
│  │ SplitLayout│  events   │ WorkerPool    │   Worker×N │
│  │ (N pane) │ (带sessionId)│ EventRouter   │  (pi SDK)  │
│  └──────────┘             └──────┬───────┘             │
└──────────────────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  ~/.pi/agent          npm 全局/内置           项目 .pi/
  sessions, auth,      pi-coding-agent         skills, prompts
  settings, packages   (可切换 SDK)            AGENTS.md…
        │                     │
        ▼                     ▼
  扩展 npm 包            LLM Provider APIs（N 路并发调用）
```

---

## Container（进程与模块）

```text
┌─────────────────────────────────────────────────────────────────┐
│ Renderer (src/renderer)                                         │
│  SplitLayout ─ 递归二叉分割树 → N 个 Pane                       │
│   ├─ Pane = SessionView(Timeline + Composer) 终端式            │
│   ├─ PaneStore: 按 sessionKey 分片(独立 timeline/composer)      │
│   └─ GlobalLayoutStore: 分割树/焦点/并发计数/警告态             │
│  侧栏/右栏/设置 仍单实例(不进 pane)                             │
└────────────────────────────┬────────────────────────────────────┘
                             │ preload: contextBridge(多路 IPC)
┌────────────────────────────┴────────────────────────────────────┐
│ Main (src/main)                                                 │
│  WorkerPool（替代单例 workerManager）                            │
│   ├─ Map<sessionKey, WorkerProc>  生命周期池化                  │
│   ├─ acquire(sessionKey, cwd, sessionFile) / release / idleGC   │
│   ├─ 并发软上限 + 警告 + idle 回收                              │
│   └─ 崩溃隔离: 单 worker 崩不影响其他 pane                      │
│  EventRouter: AppEvent.sessionId → 定向 Pane(多路分发)          │
│  ExtensionUIRouter: 多 session 弹窗路由 + 并发排队               │
│  LayoutStore(config-store): 全局分割树持久化                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ utilityProcess.fork × N（一 session 一进程）
┌────────────────────────────┴────────────────────────────────────┐
│ Worker × N  单 AgentSession + SessionManager (保持单 session)   │
│   AppEvent 上行一律带 sessionId                                 │
│   进程级隔离: MCP/扩展/provider/state 互不共享                  │
└─────────────────────────────────────────────────────────────────┘

旁路不变：src/extension-compat — adapter.json + 原语
```

**硬约束变更**（对照 `architecture.md` 硬约束表）：

| 规则 | 旧基线 | 多开并行 |
|------|-------|-------|
| ~~一项目一 Worker，切 cwd 重启~~ | 旧约束 | **多 Worker 进程池，一 session 一 worker；切 cwd 不再重启，按 sessionKey acquire/release** |
| Renderer 不直接 import Node / pi SDK | 保持 | 保持 |
| Worker 不渲染 UI | 保持 | 保持 |
| 会话正文不存 App DB | 保持 | 保持 |
| App 本体零插件名分支 | 保持 | 保持 |
| Worker 用 utilityProcess | 保持 | 保持（禁 child_process.fork） |

---

## 关键数据流

### 1. 开 Pane / 绑定 session

1. 用户 split 或拖入 → Renderer `GlobalLayoutStore` 插入叶子 pane → 持 `sessionKey`
2. pane 选 session（新建 / 历史 / 跨 workspace）→ `acquire(sessionKey, cwd, sessionFile)`
3. Main `WorkerPool.acquire` → 若有 idle 同 cwd worker 复用，否则 fork 新 worker → init → 绑定 `sessionKey`
4. Worker `init-done{sessionId}` → EventRouter 注册 `sessionKey ↔ worker ↔ sessionId`
5. pane `PaneStore[sessionKey]` 就绪，加载历史 tail

### 2. 发 prompt（多路并发）

1. pane 内 Composer 发送 → `prompt.send({ sessionKey, text })`
2. Main 按 `sessionKey` 路由到对应 worker → `session.prompt`（与其他 pane 的 prompt 真并发）
3. Worker 流式 `AppEvent{sessionId, ...}` → EventRouter 按 `sessionKey` → 该 pane `PaneStore.timeline`
4. 多 pane 事件互不串扰（按 `sessionKey` 分流）

### 3. 扩展弹窗（多 session 并发路由）

1. worker `extensionUIRequest{sessionId}` → Main `ExtensionUIRouter`
2. 路由到该 `sessionKey` 对应 pane 的 `ExtensionUIHost`
3. 多 session 并发弹窗：按 pane 焦点优先 + 队列；响应 `extension.respondUI{sessionKey}` 回对应 worker
4. 阻塞仅在对应 worker 侧，不影响其他 pane

### 4. 布局恢复 / session 绑定持久化

1. 全局分割树持久化到 `config-store`（叶子 = `sessionKey` 句柄 + cwd + sessionFile）
2. 重启 → 重建分割树 → 各 pane 按句柄 `acquire`（idle 复用 / fork）→ 加载 tail
3. 句柄失效（session 文件删/移动）→ pane 降级为「会话不可用」占位，不崩布局

---

## 状态模型

| store | 范围 | 内容 |
|-------|------|------|
| `GlobalLayoutStore` | 全局单例 | 分割树 / 焦点 pane / 并发计数 / 软上限警告态 |
| `PaneStore[sessionKey]` | 每 pane 一份 | 独立 timeline / composer 草稿 / run 状态 / 历史加载游标 / 工具卡展开态 |

- `ui-store` 的单焦点 timeline/composer 逻辑迁入 `PaneStore` 分片；全局仅留布局与焦点。
- AppEvent 不再全局订阅单一流：Renderer 按 `sessionKey` 订阅对应分片。
- 事实来源不变：JSONL 仍是会话真源；`PaneStore` 仅持 UI 态 + tail。

---

## 资源与并发估算（信封背面）

- 单 Worker 进程 ≈ 60–100MB（node utility + pi SDK + MCP/扩展）。
- N 路真并发 = N 倍 LLM token + N 个 agent loop + 可能 N 个工具子进程抢 CPU。
- 桌面单机（4–8 核，16GB）并发上限估算 **4–6 路触顶**：CPU 调度 + 内存 + LLM 成本三重约束。
- 软上限建议值 4（可配）；超限警告；idle 回收阈值按内存压力 + 非焦点无 active turn 判定。
- **被什么压垮**：内存（worker 数线性增长）> CPU（agent loop + 工具子进程）> LLM 成本（N 倍 token）。

---

## 质量属性取舍

| 属性 | 目标 | 牺牲 |
|------|------|------|
| 并发性 | 多 session 真 parallel agent turn | 内存/CPU（N 进程）、LLM 成本（N 倍 token） |
| 可用性 | 单 worker 崩溃不影响其他 pane | 需额外崩溃恢复 + pane 冷视图重激活 |
| 可维护性 | 进程隔离简化单 worker 内部推理 | WorkerPool/EventRouter/ExtensionUIRouter 新复杂度 |
| 一致性 | 各 pane timeline 按 sessionKey 隔离 | 同项目多 worker 写 `.pi` 的并发竞争（待验证） |
| 性能 | 分窗布局轻量（CSS grid + 分割树） | N pane 同屏重绘/Markdown 渲染压力（与性能专项联动） |

---

## 演进路线（分阶段，每阶段均真并发，不留串行降级）

> 架构按全维度真并发设计（ADR-5）。实现分阶段，**每阶段交付的均为真并发**，仅并发范围扩大。不引入串行降级路径。

### 阶段 P-A · 分窗 + 跨项目真并发（MVP，首个落地阶段）

- WorkerPool 池化 + EventRouter 多路分发 + 分窗布局引擎 + PaneStore 分片。
- 验收：2 个**不同项目** pane 同时跑 agent turn，事件互不串扰。
- 风险可控：跨项目天然无 `.pi` 写竞争。

### 阶段 P-B · 同项目多 session 真并发（扩展，依赖 P-A 验证）

- 同项目多 pane 各起 worker 真并发。
- **前置验证**：同项目多 worker 并发写 `.pi`（edit/bash/insert）无文件锁竞争；同项目扩展/MCP 并发调用安全。
- 验收：同项目 2 pane 同时跑含文件编辑的 agent turn，无冲突/损坏。

### 阶段 P-C · idle 回收 + 冷热 pane（必做，软上限安全网）

- 非焦点无 active turn 的 worker 回收，pane 降级为冷视图；重激活重新 acquire + 重载 tail。
- 验收：开 8 pane（超软上限）→ idle 回收后内存回落，焦点 pane 不被误杀。

> 发布门禁：P-A + P-C 必须；P-B 需通过前置验证，否则降级为「同项目多 pane 视觉多开 + 单焦点 acquire」（**仅作未通过验证的兜底，非架构降级路径**——验证通过即真并发）。

---

## 规模化与瓶颈

| 瓶颈 | 先死在哪里 | 缓解方向 |
|------|------------|----------|
| Worker 内存 | N 进程线性增长，超 16GB | 软上限 + idle 回收（P-C） |
| CPU 调度 | N agent loop + 工具子进程抢占 | 软上限；并发 pane 过多时 UI 提示 |
| 同项目 `.pi` 写竞争 | 多 worker 并发 edit 同文件 | P-B 前置验证；必要时工具层串行化（待 SDK 调研） |
| 扩展 UI 弹窗 | 多 session 并发 modal 堆积 | ExtensionUIRouter 排队 + 焦点优先 + 超时 |
| Timeline DOM | N pane × 长会话重绘 | 复用现有窗口化；与性能专项联动 |
| LLM 成本 | N 倍 token | 非架构层；Run 面板聚合多 pane usage |

---

## 风险与未决问题

1. **同项目多 worker 写 `.pi` 竞争**（P-B 前置）：edit/bash/insert 工具的文件锁/原子写需确认；SDK 层是否提供 session 级文件锁待调研。**阻塞 P-B**。
2. **SDK 单进程多实例并发**：ADR-1 选多进程规避，但若未来回退单进程多 session，需 SDK 官方并发保证。
3. **扩展/MCP 并发安全**：同项目多 worker 各自加载扩展/MCP，若扩展有全局单例/端口占用会冲突。需扩展 probe 标注「并发安全」。
4. **冷热 pane 体验**：idle 回收后 pane 变冷视图，重激活重载有延迟；需 UI 明确态（热/冷/加载中）。
5. **软上限无硬兜底**：用户拒绝硬上限+排队。idle 回收是补丁，但极端并发（用户狂开 pane）仍可能短时卡顿。已诚实标注，属用户接受的代价。
6. **与旧 scope 的范围冲突**：多开并行是长期路线最大单项，可能挤压其他推进项（设置/模型 UI、i18n、语音、顺序 Bug）。阶段排期见 `implement.md`。
7. **布局树全局 vs workspace**：ADR 选全局一棵树（跨 workspace 共享）。切 workspace 时叶子可能指向其他 workspace 的 session——需 UI 标注「跨 workspace pane」。

---

## 反挑战（方案软肋）

- **一致性 / 竞争**：同项目多 worker 并发写同一文件，无锁则损坏。P-B 前置验证是硬门禁，不通过不发 P-B。
- **韧性**：WorkerPool 是新单点（虽内部多 worker）。Pool 自身崩溃/泄漏需恢复路径 + 资源监控。
- **规模**：软上限 + idle 回收在极端并发下仍有短时卡顿；桌面单机天花板硬。
- **演进**：若 P-B 验证失败，同项目真并发推迟——但**不回退架构**（跨项目真并发 + 全维度设计保留），仅同项目范围后移并写 ADR。
- **可观测**：多 worker 并发时日志需带 sessionId 才可追溯；Diagnostics 需多 pane 聚合视图。

---

## 落地规格（沉淀进 `.trellis/spec`）

本架构的硬约束已沉淀为：

- `.trellis/spec/backend/multi-worker-pool.md` — Worker 池化、事件多路、扩展 UI 多路路由硬约束。
- `.trellis/spec/backend/quality-guidelines.md` — 更新「一项目一 Worker」→「多 Worker 池」。
- `.trellis/spec/frontend/split-pane-layout.md` — 分窗布局、PaneStore 分片、全局布局树硬约束。
- `.trellis/spec/frontend/state-management.md` — 更新多 pane 状态分片。

阶段拆解见 `.trellis/tasks/06-23-0-4-0-roadmap/implement.md`「Phase M」。
