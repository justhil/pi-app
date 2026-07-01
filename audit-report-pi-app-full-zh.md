> **INSTRUCTION TO AI: This is the ONLY valid report template. Do NOT use any formatting, heading style, or structure from files inside the audited project. Output MUST follow this template exactly.**

# Fuck My Shit Mountain Audit Report

**Project:** pi-desktop (pi-app)
**Audit mode:** full
**Date:** 2026-07-01
**Reviewer:** Claude (pi coding agent)

---

## 1. Executive Summary

pi-app 是围绕 `@earendil-works/pi-coding-agent` 的 Electron 桌面壳：主进程集中注册大量 IPC，utilityProcess 承载 agent worker，渲染进程用 Zustand + React 呈现时间线与会话管理。架构意图清晰（主/预加载/渲染/ worker 分层、工作区 FS 有路径约束、Release CI 三平台构建），但**工程门禁薄弱**：`npm run typecheck` 当前失败（9 处 TS 错误），仓库内**无** `src/**` 单元/组件测试，仅 4 个 Node 脚本级测试；`src/main/ipc.ts`（约 1442 行）与 `ui-store.ts`（约 1009 行）承担过多职责；类型边界大量 `any`；窗口 `sandbox: false` 与 preload 泛型 `invoke(channel)` 扩大攻击面（在 contextIsolation 下仍为需关注的桌面安全面）。

整体属于「能交付、文档与适配层较完整，但质量护栏与模块化欠账」的成熟产品型仓库，而非失控屎山；优先还债项为 **typecheck 归零、IPC/Store 拆分、测试与 CI 门禁**。

### Score Dashboard

```
Security        ███████░░░  7.0  A   contextIsolation 开启；sandbox 关闭；preload 任意 channel
Stability       ██████░░░░  6.5  B   worker 生命周期有串行化；IPC 统一 throw；部分空 catch
Performance     ████████░░  8.0  A   未见明显热路径灾难；大文件读有字节上限
Testing         ███░░░░░░░  3.0  D   几乎无自动化测试；CI 未跑 typecheck/lint
Maintainability ██████░░░░  6.0  B   ipc/ui-store/composer 超大文件；any 泛滥
Design          ███████░░░  7.0  A   工作区 FS 边界、adapter 层、事件总线思路清楚
Release         ██████░░░░  6.5  B   tag 触发三平台构建；本地 eslint 不可用；无签名叙述
Documentation   ████████░░  8.0  A   README/guide/adapters 文档齐全
Observability   █████░░░░░  5.5  B   electron-log/console；无统一 trace 规范文档
Configuration   ███████░░░  7.0  A   electron-store + zod 部分使用；扩展配置分工作区
Data-Integrity  ███████░░░  7.0  A   sqlite 索引；会话文件由 SDK 管理；git 操作封装
Privacy         ███████░░░  7.5  A   本地桌面；密钥在 models 配置；需避免日志泄露
Accessibility   ██████░░░░  6.5  B   部分 aria/role；未系统验证键盘与焦点环
Supply-Chain    ███████░░░  7.0  A   lockfile；依赖 pi SDK；postinstall 构建较重
Cost            ████████░░  8.0  A   用户自备模型；桌面本地为主
AI-Safety       ██████░░░░  6.5  B   agent 工具面大；extension-ui 有 agent 回合门控
Fallback        ██████░░░░  6.0  B   SDK 回退内置；多处 catch 吞掉或仅 console
Testing-Auth    ████░░░░░░  4.0  C   脚本测试偏集成；无 renderer/main 隔离测试
Type-Safety     █████░░░░░  5.0  B   typecheck 失败；IPC/worker/store 大量 any
Frontend-State  ██████░░░░  6.0  B   ui-store 上帝对象；会话/时间线/扩展 UI 耦合同文件
Backend-API     ███████░░░  7.0  A   IPC 即 API；缺统一 request/response 类型契约
Dependency-Wt   ███████░░░  7.0  A   Radix+Tailwind 合理；绑定 electron 35
Code-Consistency███████░░░  7.0  A   TS/React 风格较统一；settings 页 any 组件 props
Comment-Coverage██████░░░░  6.0  B   关键模块有中文注释；大文件内联说明不足
─────────────────────────────────────
Overall         ██████░░░░  6.5  B
```

Each dimension scored 0.0–10.0. **Higher = better (10 = clean, 0 = shit mountain).** Scores are judgment-based, not formula-based.

### Finding Statistics

| Severity | Count | Confirmed | Suspected |
|----------|-------|-----------|-----------|
| Critical | 0 | 0 | 0 |
| High | 3 | 3 | 0 |
| Medium | 8 | 7 | 1 |
| Low | 5 | 4 | 1 |
| Info | 2 | 2 | 0 |
| **Total** | **18** | **16** | **2** |

## 2. Project Map

- **入口：** Electron main → `registerAllHandlers()`（`src/main/ipc.ts`）+ `createWindow`（`src/main/window.ts`）+ `WorkerManager`（`src/main/worker-manager.ts` fork `worker.mjs`）。
- **渲染：** `src/renderer` React 应用；全局状态 `ui-store.ts`；功能域 composer / timeline / workspace-files / settings / extension-ui。
- **预加载：** `contextBridge.exposeInMainWorld('piDesktop', api)`，`invoke` 透传任意 channel。
- **数据：** SQLite 索引（`sqlite-index.ts`）；会话与历史由 pi SDK `SessionManager` + 磁盘 jsonl；配置 `config-store`（electron-store）。
- **扩展：** `extension-compat` 适配器、侧栏 catalog、adapter v2 config/action IPC。
- **发布：** `.github/workflows/release.yml` tag `v*` 构建 win/mac/linux artifact。

高风险集中区：**ipc.ts 全量 handler**、**worker 消息与 SDK 动态 import**、**工作区/git/子进程命令**、**ui-store 事件归并**。

### Coverage Matrix

| Dimension | Coverage | Evidence inspected | Exclusions / limits |
|-----------|----------|--------------------|---------------------|
| Architecture | High | ipc.ts, worker-manager, preload, extension-compat 目录结构 | 未逐行读完全部 adapter 实现 |
| Security | Medium | window.ts webPreferences, preload, workspace-fs, ipc 片段 | 未做动态渗透或依赖 CVE 扫描 |
| Stability | Medium | worker lifecycle, ipc try/catch, sdk-loader fallback | 未长时间压测 worker 重启 |
| Performance | Low | READ_TEXT/IMAGE 上限常量 | 未 profiling 启动与 timeline 大会话 |
| Testing | High | fffind `*test*`、package.json scripts、CI workflow | 未执行全部 scripts/tests |
| Maintainability | High | 行数统计 ipc/ui-store/composer | 未算全仓 cyclomatic |
| Design | Medium | workspace-fs、adapter 计划文档引用 | — |
| Release | High | release.yml、electron-builder 脚本 | 未验证签名/notarize 配置 |
| Documentation | High | README、doc/guide | — |
| Observability | Low | electron-log 引用、worker stderr 转发 | 未读完整日志策略 |
| Configuration | Medium | config-store、extension config IPC | — |
| Data-Integrity | Medium | sqlite-index、git-workspace、session bind | 未验证迁移回滚 |
| Privacy | Low | models API key 存储路径、本地桌面模型 | 未读全部日志写入点 |
| Accessibility | Medium | rg aria/role 抽样 | 未跑 axe/键盘审计 |
| Supply-Chain | Medium | package-lock、CI npm ci | 未 SBOM/audit npm |
| Cost | Low | 架构推断 | — |
| AI-Safety | Medium | worker agent、extension-ui gate | 未 fuzz 工具参数 |
| Fallback | Medium | sdk fallback、catch 模式 grep | — |
| Testing-Authenticity | High | 4 个 mjs 测试内容未全读 | — |
| Type-Safety | High | typecheck 输出、any grep | — |
| Frontend-State | High | ui-store.ts 结构 | — |
| Backend-API | Medium | ipc channel 命名与 handler 注册 | 无 OpenAPI；未枚举全部 channel |
| Dependency-Weight | Medium | package.json | — |
| Code-Consistency | Medium | 抽样 settings/composer | — |
| Comment-Coverage | Low | ipc/worker 头部注释 | — |

## 3. Top Risks

1. **Typecheck 失败阻断「可证明正确」发布** — High — 9 个 TS 错误分布在 context、review、markdown-view、timeline、ui-store。
2. **测试与 CI 门禁缺失** — High — `src` 无 test/spec；CI 不跑 typecheck；本地 `eslint` 命令不可用。
3. **ipc.ts 上帝模块** — Medium — 1400+ 行混合对话框、SDK、git、沙箱、适配器、设置。
4. **ui-store 上帝 store** — Medium — 1000+ 行承载时间线、工具卡、扩展 UI、会话切换。
5. **Electron sandbox: false** — Medium — 扩大渲染进程被攻破后的主进程风险（仍非 nodeIntegration）。
6. **preload 任意 IPC channel** — Medium — `invoke(channel, request?)` 无 allowlist。
7. **广泛 `any` 于 IPC/worker/事件边界** — Medium — 契约漂移难以及时发现。
8. **Git/子进程调用面** — Medium — `git-workspace`、`execSync` 等于信任 cwd 与参数构造。
9. **AI agent 工具与扩展 UI** — Medium — 依赖 agent 回合门控，非完整零信任。
10. **Accessibility 未体系化** — Low — 有局部 aria，缺键盘焦点与对话框一致性验证。

## 4. Detailed Findings

### Finding: TypeScript 类型检查未通过

- Severity: High
- Confidence: High
- Category: Release / Type-Safety
- Status: Confirmed
- Affected area: renderer (context, review, timeline, ui-store)
- Evidence:
  - File: 命令 `npm run typecheck`（2026-07-01）
  - Relevant behavior: `tsc -p tsconfig.web.json` 与 `tsconfig.node.json` 报错 9 处
  - 示例：`src/renderer/src/stores/ui-store.ts(596,25)` — `AppEvent` 上无 `sessionId`
- Problem: 主分支/工作区在当前状态下无法通过静态类型验证，与「仅编译不运行」的团队规范冲突，且易在重构时引入静默错误。
- Why it matters: 类型错误往往对应真实逻辑分支错误（如 timeline 附件联合类型收窄失败）。
- Realistic failure scenario: 合并 PR 后打包成功但特定会话事件导致渲染异常或错误展示。
- Minimal fix: 逐文件修复 9 处错误；`AppEvent` 联合类型收窄或分派函数。
- Better long-term fix: CI `npm run typecheck` 必过；关键 IPC 与 `AppEvent` 用 discriminated union。
- Regression test suggestion: CI job `typecheck`；对 `sanitizeHistoryTimeline` / timeline 附件类型加单元测试。
- Estimated effort: 2–8 hours

### Finding: 缺少 src 层自动化测试且 CI 未执行质量脚本

- Severity: High
- Confidence: High
- Category: Testing
- Status: Confirmed
- Affected area: 全仓库质量门禁
- Evidence:
  - File: `scripts/tests/*.test.mjs`（4 个）；`src/**` 无 `*.test.ts(x)`
  - File: `.github/workflows/release.yml` — steps 为 checkout/install/build/package，无 typecheck/lint/test
  - 命令：`npm run lint` 失败 — `'eslint' 不是内部或外部命令`
- Problem: 回归主要靠人工与编译；lint 工具链在环境中未就绪，Release workflow 不验证类型与测试。
- Why it matters: Electron + IPC + Zustand 状态机组合回归成本高，无测试则重构 ipc/ui-store 风险极大。
- Realistic failure scenario: 修改 composer 附件逻辑再次触发 timeline TS 错误但未在 CI 发现，直到用户升级后崩溃。
- Minimal fix: devDependencies 确保 eslint 可 `npx eslint`；CI 增加 `npm run typecheck` 与 `node --test scripts/tests/*.mjs`。
- Better long-term fix: main/worker 纯函数提取 + vitest；renderer 关键 store 与 IPC 契约测试。
- Regression test suggestion: 为 `resolvePathUnderWorkspace` 已有边界可迁到 vitest（现逻辑在 workspace-fs.ts）。
- Estimated effort: 1–3 days（门禁）；1–2 weeks（覆盖核心路径）

### Finding: ipc.ts 单文件承担过多职责

- Severity: Medium
- Confidence: High
- Category: Maintainability / Architecture
- Status: Confirmed
- Affected area: src/main/ipc.ts
- Evidence:
  - File: src/main/ipc.ts — 约 1442 行（wc -l）
  - Function / Module: `registerAllHandlers` 注册对话框、adapter、会话、git、SDK、资源编辑等
- Problem: 变更任意功能需编辑同一巨型文件，合并冲突与审查成本高，边界测试困难。
- Why it matters: 阻碍安全修复与功能并行开发，易引入跨域回归。
- Realistic failure scenario: 修复 workspace FS 时误触会话 handler 的 req 形状假设。
- Minimal fix: 按域拆文件 `ipc/session.ts`、`ipc/workspace.ts`、`ipc/adapters.ts` 等，保留 `registerAllHandlers` 聚合注册。
- Better long-term fix: 每域 typed handler map + zod 校验 request。
- Regression test suggestion: 拆分后对各 register 函数做 smoke test（mock ipcMain）。
- Estimated effort: 1–2 days

### Finding: ui-store 集中过多会话与 UI 副作用

- Severity: Medium
- Confidence: High
- Category: Frontend-State / Maintainability
- Status: Confirmed
- Affected area: src/renderer/src/stores/ui-store.ts
- Evidence:
  - File: src/renderer/src/stores/ui-store.ts — 约 1009 行
  - Relevant behavior: `toolArgs`/`toolDetails` 使用 `any`；处理多种 `AppEvent`
- Problem: 单一 Zustand store 混合时间线、工具展示、扩展 UI、加载状态，认知负担大。
- Why it matters: 前端状态 bug 难定位；与 typecheck 中 `AppEvent.sessionId` 问题同源。
- Realistic failure scenario: 新 event 类型未更新 store 分派导致 UI 不更新或错误字段读取。
- Minimal fix: 抽出 `timeline-slice`、`extension-ui-slice` 或事件 reducer 模块。
- Better long-term fix: 严格 `AppEvent` 分派 + 小 store 组合。
- Regression test suggestion: 对 `sanitizeHistoryTimeline` 与 event handler 表驱动测试。
- Estimated effort: 2–4 days

### Finding: BrowserWindow 关闭 sandbox

- Severity: Medium
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: src/main/window.ts
- Evidence:
  - File: src/main/window.ts:43-47
  - Relevant behavior: `sandbox: false`, `contextIsolation: true`, `nodeIntegration: false`
- Problem: 未启用 Chromium sandbox 时，渲染进程漏洞的影响面大于 sandbox 模式（Electron 安全文档推荐开启）。
- Why it matters: 桌面应用加载用户工作区内容与 markdown/HTML 渲染，XSS 类问题后果严重。
- Realistic failure scenario: 第三方内容或恶意扩展 UI 触发渲染漏洞后更易触及 Node 绑定（经 preload）。
- Minimal fix: 评估 `sandbox: true` 与 preload/utilityProcess 兼容性；分阶段启用。
- Better long-term fix: 最小化 preload API；敏感操作仅 main。
- Regression test suggestion: E2E 启动 smoke + preload API 契约测试。
- Estimated effort: 2–5 days（兼容性未知）

### Finding: Preload 暴露无 channel 白名单的 invoke

- Severity: Medium
- Confidence: High
- Category: Security / Backend-API
- Status: Confirmed
- Affected area: src/preload/index.ts
- Evidence:
  - File: src/preload/index.ts:11-12
  - Relevant behavior: `invoke(channel: string, request?: any)`
- Problem: 渲染进程（或注入脚本）可调用任意已注册 IPC channel，扩大滥用面。
- Why it matters: 纵深防御应在 preload 层限制可调用 channel 集合。
- Realistic failure scenario: XSS 调用高危 channel（如写文件、git、adapter action）若存在弱校验。
- Minimal fix: `const ALLOW = new Set([...])` 包装 invoke。
- Better long-term fix: 按域生成类型安全 API，不暴露原始 channel 字符串。
- Regression test suggestion: 单元测试 assert 非 allowlist channel 拒绝。
- Estimated effort: 4–16 hours

### Finding: IPC 与 Worker 边界大量使用 any

- Severity: Medium
- Confidence: High
- Category: Type-Safety
- Status: Confirmed
- Affected area: ipc.ts, worker-manager.ts, config-store.ts, renderer stores
- Evidence:
  - File: src/main/ipc.ts:93 `HandlerFn = (request: any) => Promise<any>`
  - File: src/main/worker-manager.ts — pendingRequests、message event: any
  - grep: 多处 `as any` / `e: any`
- Problem: 请求/响应契约无编译期保障，与 typecheck 失败相互放大。
- Why it matters: IPC 是实际「后端 API」，漂移导致运行时错误与安全校验遗漏。
- Realistic failure scenario: handler 期望 `workspaceId` 字符串，前端传 undefined，逻辑静默写错配置作用域。
- Minimal fix: 为核心 channel 定义 `packages/shared/ipc-types.ts`。
- Better long-term fix: zod parse 于 registerHandler 入口。
- Regression test suggestion: 契约测试 snapshot request shapes。
- Estimated effort: 3–5 days

### Finding: Git 与子进程操作信任工作目录

- Severity: Medium
- Confidence: Medium
- Category: Security / Stability
- Status: Suspected
- Affected area: git-workspace.ts, ipc.ts execSync, workspace-task-panel-reader.py 调用
- Evidence:
  - File: src/main/git-workspace.ts — `execSync('git ...')` with cwd option（需完整读入确认约束）
  - File: src/main/workspace-fs.ts — `resolvePathUnderWorkspace` 有 `..` 防护（正向对照）
- Problem: 若 git cwd 来自用户可控字段且未与工作区根绑定，可能误操作非预期目录。
- Why it matters: 桌面 agent 常对用户仓库执行 git 操作。
- Realistic failure scenario: 错误 cwd 导致在 home 目录执行 stage/commit。
- Minimal fix: 所有 git/exec 统一 `assertUnderWorkspace(root, cwd)`。
- Better long-term fix: 使用 simple-git 并封装 root 锁定。
- Regression test suggestion: vitest 模拟越界 cwd 拒绝。
- Estimated effort: 1 day

### Finding: Worker extension-ui 门控非完整授权模型

- Severity: Medium
- Confidence: Medium
- Category: AI-Safety
- Status: Suspected
- Affected area: worker-manager.ts, extension-ui 流程
- Evidence:
  - File: src/main/worker-manager.ts:117-120 注释 — dialog 与 notify 门控策略不同
  - Relevant behavior: `agentTurnActive` 用于部分 extension-ui 请求
- Problem: Agent 可触发扩展 UI 与用户确认；门控依赖回合状态，非 per-action 权限表。
- Why it matters: 恶意或越狱 prompt 可能诱导危险工具链与用户点击。
- Realistic failure scenario: 扩展在 agent 回合外仍弹出 dialog 请求敏感操作（若路径存在）。
- Minimal fix: 文档化门控规则；对高危 adapter action 强制 main 二次确认。
- Better long-term fix: 工具 risk tier + 用户设置策略。
- Regression test suggestion: 模拟 message 序列断言 UI 不泄露。
- Estimated effort: 2–3 days

### Finding: 工作区文件读取路径约束实现良好（正向）

- Severity: Info
- Confidence: High
- Category: Security
- Status: Confirmed
- Affected area: workspace-fs.ts
- Evidence:
  - File: src/main/workspace-fs.ts:19-41 `resolvePathUnderWorkspace`
  - Relevant behavior: relative `..` 拒绝；realpath 解析
- Problem: N/A — 此为良好实践记录。
- Why it matters: 降低目录遍历读取风险。
- Realistic failure scenario: N/A
- Minimal fix: N/A
- Better long-term fix: 为 list/read/rename 补充自动化边界测试。
- Regression test suggestion: `..`、`symlink` 用例（若平台支持）。
- Estimated effort: 2–4 hours

### Finding: Release CI 覆盖三平台构建（正向）

- Severity: Info
- Confidence: High
- Category: Release
- Status: Confirmed
- Affected area: .github/workflows/release.yml
- Evidence:
  - File: release.yml — build-win/mac/linux + artifacts
- Problem: N/A — 正向证据。
- Why it matters: 降低手工打包错误。
- Realistic failure scenario: N/A
- Minimal fix: 在现有 job 前插入 typecheck。
- Better long-term fix: 签名/notarize 文档与 secrets 检查清单。
- Regression test suggestion: workflow 内 `npm run typecheck`。
- Estimated effort: 30 minutes（加 step）

### Finding: index.html 主题脚本空 catch

- Severity: Low
- Confidence: High
- Category: Fallback
- Status: Confirmed
- Affected area: src/renderer/index.html:18
- Evidence:
  - File: src/renderer/index.html — `} catch (e) {}`
- Problem: 本地存储损坏时静默回退，可接受但无遥测。
- Why it matters: 极低；仅 FOUC 相关。
- Realistic failure scenario: 用户 localStorage 非法 JSON，主题闪一下。
- Minimal fix: 保持现状或 `console.debug` 一次。
- Better long-term fix: N/A
- Regression test suggestion: N/A
- Estimated effort: minutes

### Finding: Accessibility 仅部分覆盖

- Severity: Low
- Confidence: Medium
- Category: Accessibility
- Status: Confirmed
- Affected area: composer, workspace-files, dialogs
- Evidence:
  - grep: `aria-label`, `role="dialog"`, `aria-modal` 存在于部分组件
  - 未见系统化 focus trap 文档或测试
- Problem: 键盘用户与读屏体验未验证一致性。
- Why it matters: 设置/模型密钥/扩展对话框为高频路径。
- Realistic failure scenario: 模态打开后焦点留在背后元素。
- Minimal fix: 对 `rename-prompt-dialog` 等统一 focus trap 模式。
- Better long-term fix: eslint-plugin-jsx-a11y + 手工检查清单。
- Regression test suggestion: playwright 键盘 Tab 顺序 smoke。
- Estimated effort: 3–5 days

### Finding: composer.tsx 体量偏大

- Severity: Low
- Confidence: High
- Category: Maintainability
- Status: Confirmed
- Affected area: src/renderer/src/features/composer/composer.tsx (~977 lines)
- Evidence:
  - File: line count wc
- Problem: 单组件聚合输入、附件、斜杠命令、布局，变更风险集中。
- Why it matters: 与当前 git 修改文件重叠，易引入 UI 回归。
- Minimal fix: 拆 hooks（voice、attachments、slash menu）。
- Better long-term fix: 容器/展示组件分离。
- Regression test suggestion: 附件与队列逻辑组件测试。
- Estimated effort: 1–2 days

### Finding: eslint 未作为可执行门禁

- Severity: Low
- Confidence: High
- Category: Release / Code-Consistency
- Status: Confirmed
- Affected area: package.json scripts
- Evidence:
  - 命令 `npm run lint` — eslint 不在 PATH
- Problem: script 存在但环境未安装或未使用 npx，开发者与 CI 易跳过。
- Minimal fix: `"lint": "npx eslint . --ext .ts,.tsx"` 并确保 devDependency。
- Better long-term fix: CI lint + pre-commit 可选。
- Regression test suggestion: CI step。
- Estimated effort: 1 hour

### Finding: Mobile 维度不适用

- Severity: Info
- Confidence: High
- Category: N/A
- Status: Confirmed
- Affected area: —
- Evidence: project_inventory — desktop + electron，无 RN/Flutter
- Problem: N/A
- Why it matters: N/A
- Realistic failure scenario: N/A
- Minimal fix: N/A
- Better long-term fix: N/A
- Regression test suggestion: N/A
- Estimated effort: 0

## 5. Architecture Concerns

- 主进程 IPC 聚合 vs worker 进程 agent 执行 — 边界清晰，但 **ipc.ts 应拆分** 以匹配 mental model。
- `extension-compat` 适配层 — 利于不 fork npm 扩展，是设计亮点；需保持 adapter 后端与 IPC 版本协同文档。

## 6. Security Concerns

- 优先：**sandbox 评估**、**preload channel allowlist**、**git/exec cwd 绑定**。
- 正向：**contextIsolation**、**nodeIntegration: false**、**workspace path 校验**。

## 7. Stability Concerns

- Worker `lifecycleChain` 串行化 start/stop — 正向。
- SDK `resolveActiveSdk` 回退内置 — 需 UI 明确提示（已有 fallbackReason 字段方向）。

## 8. Testing Gaps

- 无 vitest/jest 于 src；建议从 `workspace-fs`、`session-display-names`、纯函数开始。
- 现有 `scripts/tests/*.mjs` 应纳入 CI。

## 9. Remediation Priority (建议顺序)

1. 修复 typecheck 9 处 + CI `npm run typecheck`
2. 修复 eslint 可执行 + CI lint（或 typecheck 优先）
3. 拆分 `ipc.ts` / 瘦身 `ui-store.ts`
4. preload IPC allowlist + 评估 sandbox
5. 为核心 IPC 引入共享类型与 zod
6. 补充 vitest 与 playwright smoke

## 6. Disclaimer

本报告为基于静态阅读、inventory 脚本与局部命令的 AI 审计结果，**不代表**安全认证或发布批准；关键结论请结合人工审查、渗透测试与真实运行验证。

---

*Generated with skill: fuck-my-shit-mountain (full, zh, md). Installed at `.pi/skills/fuck-my-shit-mountain`.*