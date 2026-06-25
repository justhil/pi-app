# 架构读图评审（Architecture Copilot · 读图模式）

> 评审对象：当前仓库实现 + README + `.trellis/spec`，对照「pi 桌面 GUI / 编码 Agent 桌面」类产品的合理期望。  
> 日期：2026-06-21

---

## 结论（一页）

| 维度 | 判断 |
|------|------|
| **本质** | 单机桌面 **pi 壳**：价值在「图形时间线 + 扩展 TUI 替换 + 与终端 pi 共用会话」，不是独立 Agent 平台。 |
| **全景** | Main / Worker / Renderer 三层边界**总体清晰**；IPC 面较宽，部分能力仍 **Main 与 Worker 双路径**（会话列表、模型列表）。 |
| **取舍** | 正确选择：**不 fork pi、不改扩展包**；代价是兼容层与 adapter 表维护成本，以及 **TUI  parity 长期追赶**。 |
| **死穴（优先）** | ① 单 Worker 单 cwd — 多项目/多会话并发弱；② IPC/能力 **半成品与 stub** 与 UI 暴露不一致；③ **文档与 spec 引用断裂**；④ Windows 原生依赖（better-sqlite3、滚动条）与 Electron ABI；⑤ SDK 三档切换后的 **全局 npm 与终端耦合**。 |

---

## 与目标架构的一致处

1. **事实来源**：会话 JSONL、`settings.json` 写回策略与 README 一致，未另建聊天主库。
2. **进程模型**：`utilityProcess` + 禁止 Renderer 直连 SDK，符合 spec quality-guidelines。
3. **扩展方向**：`extension-compat` + 通用 `adapter.*` IPC；`tool-card-templates` 用模板而非大量 `if (plugin)`（需持续 grep 审计）。
4. **Worker 韧性**：SDK 动态 import 失败回退内置、`worker-manager` 生命周期串行化与 stale exit 防护，近期已补强。
5. **桌面体验层**：悬浮 Composer、队列 `queue_update`、TUI 快捷键（Alt+↑ / 双击 Esc）、右栏可配置 — 与「Agent 工作台」方向一致。

---

## 架构偏移与不足

### 1. 文档与规范漂移（高）

| 现象 | 影响 |
|------|------|
| `.trellis/spec/backend/index.md` 引用 `docs/architecture.md`、`adapter-layer-plan.md` 等 | **docs/ 曾为空**，规范与实现脱节，新人/子 agent 易误判「已有设计文档」。 |
| README 架构段较简，缺 Container 级数据流与 ADR | 重大决策（SDK 三档、session 懒绑定、双路径 list）未沉淀 ADR。 |
| Trellis 任务 `06-21-sdk-mechanism` 的 prd/design 在 `.trellis/tasks/`，未合并到 docs | 产品级决策散落任务目录。 |

**建议**：以 `docs/architecture.md` 为锚；将 `adapter-layer-plan` 从 spec 摘要或任务中抽出正式版；每个「双路径」决策写 1 条 ADR。

### 2. IPC 契约 vs 实现（高）

`ipc-contract.ts` 定义较完整，但 Main 中仍存在明显 **stub / TODO**（读代码确认）：

- `session.fork` / `session.clone` → 返回 stub 会话
- `session.compact` / `session.export` → TODO
- `model.cycle` → TODO
- `registry.refresh` → 占位

**偏移**：UI 或斜杠命令若暴露上述能力，会造成「点了无效」；与「工具型工作台」可信度冲突。

**建议**：未实现 channel 在 preload 层或设置里 **不可见**；或统一返回结构化 `NOT_IMPLEMENTED` 供 UI toast。

### 3. Main 与 Worker 双路径（中）

- `session.list`、`model.list` 在 Worker 未启动或兜底时，Main 直接 `import(resolveActiveSdk().entryPath)` 使用 `SessionManager` / `ModelRegistry`。
- Worker 内会话与 Main 扫盘列表的 **排序、过滤、沙箱会话** 需长期保持语义一致，否则「列表能点开但 Worker 无会话」类 bug 复发。

**建议**：单一权威：**Worker 就绪后只信 Worker**；Main 扫盘仅作 **degraded mode** 并在 UI 标注。

### 4. 兼容层 v2 落地度（中）

Spec 要求：**App 本体（除 extension-compat）零插件专属 IPC**。现状：

- ~~`trellis.getState` / `trellis-reader`~~ → 已改为 **`adapter.sidePanel.getState`** + 原语 **`workspace-trellis` / `workspace-tasks`**（见 `doc/adapter-layer-plan.md` §4.5、§7）。
- `pi-packages-sync` 内置 `pi-search` git 源 — 偏 **发行策略**，不是架构核心但增加特例感。
- `tool-card-templates` 对 subagent 树形态仍有数据结构分支；扩展弹窗走 `interact` + `ExtensionUIHost`。

**现状**：Trellis npm 扩展通过 **`trellis.adapter.json`** 接线；读盘逻辑在 **通用原语** `workspace-task-panel-reader.ts`，非插件名 IPC。

### 5. 可观测性与恢复（中）

- Worker 崩溃：有重启与 session 恢复路径，但 **无长任务续跑**（README 已说明）。
- Diagnostics 面板与结构化日志（`%APPDATA%/pi-desktop/logs`）在 spec 中有描述，**需核对 UI 是否完整暴露** Worker 状态、probe、registry 失败原因。
- AppEvent `seq` 断号与快照恢复：spec 要求有，实现需 **单测/手测清单** 固化。

### 6. 数据层（中低）

- README 写 electron-store + SQLite 索引；需明确 **SQLite 当前用于哪些索引**、是否与「不存聊天正文」冲突。
- `better-sqlite3` 与 Electron **NODE_MODULE_VERSION** 不匹配会导致 workspace 打开失败（已在实机踩坑）— 应写入 `docs/` 开发与发布检查项。

### 7. SDK 三档机制（中）

- **内置 / 全局 / userData 独立环境** 超出早期「仅 userData 多版本」任务文档，README 未更新。
- 全局 `npm install -g` 与终端 pi **同源** 是特性也是风险；需在文档中写清 **回退内置** 与用户手动 `npm uninstall -g` 的边界。
- Worker `getMessages` 与 `activeSdkPath` 的 pkgRoot 推导 — 对 **全局/用户 entry 文件路径** 敏感，属高维护点。

### 8. 前端架构（低中）

- 状态：**Zustand UI + AppEvent 流** 符合 spec；Timeline 虚拟窗口（`renderCount`）与历史 `prepend` 逻辑复杂，**缺架构图上的「历史加载状态机」说明**。
- 自绘滚动条、进度条、Composer 渐变 — **大量壳层逻辑在 CSS/组件**，与 pi 内核无关，建议单独 `docs/ui-shell.md` 避免 architecture 膨胀。
- i18n / 设置全屏滚动锁定 — 已修；属体验债，非结构问题。

### 9. 安全与多租户（低，桌面单用户）

- Renderer `sandbox` + `contextIsolation` 应按 spec 保持。
- 扩展 `blocked` 与 active tools 过滤、远程 registry 签名校验 — **实现深度需对照 security 清单**（若 registry 仍为 TODO，则攻击面小但未完成产品承诺）。

---

## 规模化与「涨 100 倍」桌面语境

此处「100 倍」指：**更长会话、更多扩展、更多并发工具、更大 diff**，而非 100 万 QPS。

| 瓶颈 | 先死在哪里 | 缓解方向 |
|------|------------|----------|
| 单 Worker | 一个 cwd 一轮 run；切项目必重启 | 接受；或未来多 Worker 池（成本高） |
| Timeline DOM | 超长会话 + 全量渲染 | 已有窗口化；需上限与 compaction UI 联动 |
| JSONL 冷读 | `getMessages` / 树解析大文件 | 尾部加载已做；树/分支应增量索引 |
| 扩展 UI RPC | 大量 modal 堆积 | 超时、队列、取消与 run abort 联动 |
| LLM 成本 | 非架构层，但 Run 面板应防误导性「成功」 | metrics 与 usage 来源单一化 |

---

## 建议补的 ADR（短清单）

1. **SDK 生效优先级**：builtin / global / user + fallback 规则。  
2. **Session 懒绑定**：`setPendingBind` / `prepare` / 首条发送再 `open` 的语义。  
3. **session.list 权威源**：Worker vs Main 扫盘。  
4. **Trellis 面板**：只读、python 依赖、是否纳入「官方能力」而非扩展。  
5. **兼容层 v2 边界**：哪些 `custom` kind 允许硬编码在 `extension-ui-host`。

---

## 演进路线（建议）

| 阶段 | 聚焦 |
|------|------|
| **当前 MVP+** | 补齐 stub IPC 或隐藏入口；固化 SDK 文档；Diagnostics 与日志可查；Electron rebuild 进 README/CI。 |
| **成长期** | adapter 表覆盖常用扩展；registry 签名与刷新；session fork/compact 与 pi 对齐。 |
| **成熟期** | 可选多 Worker 或会话队列；更完整的 eval/门禁（若做团队版再议）。 |

---

## 必问问题（若继续深化架构）

1. Trellis 是否长期作为 **一等公民**（与 pi 扩展并列），还是迁到「可选工作区插件」？  
2. 临时沙箱会话是否要与磁盘项目 **同一套 session.list API**，还是刻意隔离？  
3. 远程 registry 是否仍要做？若不做，应从契约与设置中 **删除承诺**。

---

## 评审产出物

- 已新增：[architecture.md](./architecture.md)（结构与数据流）  
- 本文档：偏移、不足、风险与 ADR 建议  
- 索引：[README.md](./README.md)