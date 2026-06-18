# Pi Worker 进程与 SDK 集成

## Goal
创建 Pi Worker 进程，集成 pi SDK，建立事件转换和 Worker 生命周期管理。

## Requirements
- utilityProcess.fork() 创建 Pi Worker。
- MessageChannel 双向通信（Main ↔ Worker）。
- Worker 内加载 @earendil-works/pi-coding-agent SDK。
- createAgentSessionRuntime 封装。
- 复用 ~/.pi/agent 配置（AuthStorage, ModelRegistry, SessionManager）。
- Event normalizer：pi SDK event → AppEvent。
- Worker 生命周期：一个项目一个 Worker，切项目换 Worker。
- session.prompt() 调用。
- session.fork/clone/rename/compact/export 调用。
- model.set/cycle, thinkingLevel.set 调用。
- prompt.steer/followUp 调用。
- commands.list 调用（合并 skills + prompts + extension commands）。

## Acceptance Criteria
- [ ] Main 能启动和停止 Worker。
- [ ] Worker 能创建 AgentSession 并接收 prompt。
- [ ] Worker 能输出 AppEvent 流到 Main。
- [ ] 切换项目能正确停止旧 Worker 启动新 Worker。
- [ ] session 操作（list/open/new/fork/clone/rename/compact/export）可用。
- [ ] model 和 thinking level 切换可用。
- [ ] steer/followUp 可用。

## Dependencies
- ipc-contract（需要类型定义）。
- scaffold（需要项目结构）。
