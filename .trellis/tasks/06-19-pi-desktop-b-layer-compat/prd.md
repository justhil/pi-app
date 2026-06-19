# PRD: B 层兼容 Phase R0-R2

## 背景

对照 `docs/compatibility-matrix-and-roadmap.md`，推进本机 31 个 packages 的桌面兼容。
底线约束（硬性）：

- **不修改** `~/.pi/agent/npm` 下任何扩展源码
- **不 fork / 不改** pi SDK
- 扩展配置 **app-local**（不写 pi settings）
- **C 层不复刻**（powerline/nano/tps/amp 装饰）

## 范围（按 Phase）

### Phase R0 — 管线（优先）
- R0-1 斜杠/命令执行结果 → AppEvent → Timeline
- R0-2 斜杠参数补全（getCommandCompletions + Composer）
- R0-3 配置 Host 诚实化（configKeys meta，无 keys 则说明页，禁止假 defaults）
- R0-4 未登记包补 meta（ace、sequential-thinking、Aegis、themes 类）

### Phase R1 — native/partial 抬升
- R1-1 Ask preview 并排
- R1-2 Markdown Preview 面板
- R1-3 Studio 导出打开
- R1-4 Image/multimodal 卡 + Host
- R1-5 Skills-manager getSkills 真列表

### Phase R2 — headless 体验
- R2-1 subagents 进度卡
- R2-2 intercom 侧栏
- R2-3 context 只读面板
- R2-4 rewind/continue/goal/btw/pisync 统一 SlashOutcome
- R2-5 mcp 诊断页

## 验收标准

1. `npm run build` 全绿（main/preload/renderer）
2. 不包含 `~/.pi/agent/npm` 与 pi SDK 路径改动（git diff 验证）
3. 对照表覆盖的 tier 在设置→适配器页一致
4. 每个子任务附带最小验证步骤

## 非目标

- A 层原生能力（已另立）
- C 层复刻
- 远程 registry 渲染包分发
