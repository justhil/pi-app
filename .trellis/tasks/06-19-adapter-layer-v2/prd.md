# Adapter Layer v2：声明式兼容层

**权威设计文档**：`docs/adapter-layer-plan.md`（本文是其任务化实现跟踪，不重复细节）。

---

## 背景

`pi Desktop` 是替代 pi TUI 的独立 agent 桌面 app，围绕 pi 内核构建，功能范围按 `architecture.md` 保守第一版。

当前「适配器」声明在 meta，实现散在多处硬编码：`extension-config-form.tsx` 的 `if(id===...)`、`timeline.tsx` 的 `if(isPiSearchTool)`、`ui-store.ts` 的 `piSearchStatusFromUpdate`、`main/pi-search-config.ts` + `ipc.ts` 的 `piSearch.config.*` 专用 channel，以及 `native-renderers.ts` + ExtensionUIHost 问卷 + Trellis 面板这类 trellis/ask 的 native 专属交互代码。每加一个 pi-search 级别插件要改多处源码，违背「方便扩展」目标。

## 目标

把硬编码收敛成「预设 UI 原语（按交互类型）+ 声明式 adapter.json（按插件）」，使新增普通插件只需一个 JSON 文件、不改 App 源码。

## 硬边界（最高约束）

App 本体除 pi 内核外**不留任何具体插件的专属代码**，包括此前标 `native` 的 trellis / ask。兼容层管三类界面长相：

1. **配置页**（设置里单向读写）
2. **工具卡**（Timeline 只读展示）
3. **交互式工具 UI**（工具执行中弹出、作答回传 Worker 继续 turn，如 ask 问卷 / trellis clarify）

trellis/ask 不再作为 native 例外，一律走兼容层原语。

## 核心决策（详见 docs §2）

1. 作用域：只管界面长相（匹配/配置页/工具卡）；configFile 作为配置页属性可选声明。
2. 作者：App 内置 JSON + `~/.pi/desktop/adapters/`、`.pi/desktop/adapters/` override。
3. 存储：声明 configFile 则读写该文件（与命令行共用），否则 App 私有。
4. 容错：降级继续 + 红字提示。

## 范围（不做什么）

- 不改 `~/.pi/agent/npm` 扩展源码，不 fork pi SDK。
- A 层（pi 原生能力）不受影响，不进 adapter.json。
- 不做图灵完备 DSL；派生用受限 `${field}` + 三元。

## 实现阶段

详见 `docs/adapter-layer-plan.md` §8，摘要：

- **Phase A 骨架**：adapter.json 类型 + 校验 + `loadAdapterCatalog()` + 通用 `adapter.config.*`/`adapter.action.run` IPC + 原语组件库空架子（default schema 表单 + default 工具卡 + questions 交互原语）+ 双轨（查表优先，回退 if 分支）。
- **Phase B pi-search 首样本**：写 `pi-search.adapter.json`，验证四件事（配置页/工具卡/状态行/落盘/httpCheck），删 pi-search 全部专属代码。
- **Phase C native 迁移**：ask → `interact.questions` 吃掉 ExtensionUIHost 问卷；trellis_subagent → `toolCard.tree` + `interact.clarify` 吃掉 Trellis 面板 native 专属；删 `native-renderers.ts`。
- **Phase D 其余迁移**：image→media、subagent→tree、preview→default+openPath。
- **Phase E 收尾**：原语清单固化、全量冒烟、删剩余 if 分支、grep 审计 App 本体无插件名分支。

## 验收标准（DoD）

1. `npm run build` 三目标全绿。
2. pi-search 全链路工作（配置读写、httpCheck、list 卡、statusField），**App 源码无 pi-search 专属分支**（grep 仅剩 adapter.json + 注释）。
3. ask 问卷走 `interact.questions` 原语，作答回传 Worker 继续 turn；**无 ExtensionUIHost 专属问卷组件**。trellis_subagent 走 `toolCard.tree` + `interact.clarify`；**无 native-renderers 专属解析**。
4. 新增「几个字段 + 文本工具结果」虚拟插件：只加一个 JSON，dev 即可见配置页与工具卡，**不改 App 源码**。
5. override 目录放坏 JSON：整页不崩，坏项红字，内置兜底。
6. Timeline / Config Host / 交互 Host 无 `if (id === ...)` / `if (toolName === ...)` 分支，全查表。
7. **grep 审计**：`src/`（除 `src/extension-compat/`）无 `pi-search`/`trellis`/`ask`/`image` 等具体插件名分支（仅 adapter.json + 注释除外）。

## 相关文件

- 权威设计：`docs/adapter-layer-plan.md`
- 现状硬编码：
  - `src/extension-compat/adapters-registry.ts`（声明，保留并逐步被 JSON 替代）
  - `src/extension-compat/plugin-adapter-meta.ts`（声明，保留并逐步被 JSON 替代）
  - `src/renderer/src/features/extension-ui/extension-config-form.tsx`
  - `src/renderer/src/features/timeline/timeline.tsx`
  - `src/renderer/src/stores/ui-store.ts`
  - `src/main/pi-search-config.ts`（Phase B 删）
  - `src/main/ipc.ts`（Phase B 清 piSearch 专用 channel）
  - `src/renderer/src/features/timeline/pi-search-tools.ts`（Phase B 删）
  - `src/renderer/src/features/timeline/pi-search-tool-card.tsx`（Phase B 删）
  - `src/renderer/src/features/extension-ui/pi-search-config-panel.tsx`（Phase B 删）

## 状态

- [x] Phase A 骨架
- [x] Phase B pi-search 首样本
- [ ] Phase C native 迁移（trellis/ask）
- [ ] Phase D 其余迁移
- [ ] Phase E 收尾
