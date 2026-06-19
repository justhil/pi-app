# Type Safety

> pi Desktop 类型安全和运行时校验规范。

---

## Overview

TypeScript 严格模式。核心类型定义在 `packages/shared/`，由 Renderer、Main、Worker 共享。IPC 契约和 AppEvent 必须有运行时校验。

---

## Type Organization

### 共享类型

放在 `packages/shared/`：

| 文件 | 内容 |
|------|------|
| `ipc-contract.ts` | Renderer/Main/Worker 共享的 IPC 方法签名 |
| `app-events.ts` | AppEvent 四类类型定义 |
| `schemas.ts` | zod 或 typebox 运行时校验 schema |

### 本地类型

- Feature 内私有类型放同目录 `types.ts`。
- 组件 Props 用 TypeScript interface，不用 inline type。

---

## AppEvent 类型

四类事件，所有事件都有基础字段：

```ts
type AppEventBase = {
  seq: number;
  workspaceId: string;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  timestamp: number;
};

type AppEvent = MessageEvent | ToolEvent | FileEvent | RunEvent;
```

### MessageEvent

```ts
type MessageEvent = AppEventBase & {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  phase: 'start' | 'delta' | 'end';
  text?: string;
};
```

### ToolEvent

```ts
type ToolEvent = AppEventBase & {
  type: 'tool';
  toolCallId: string;
  toolName: string;
  phase: 'start' | 'update' | 'end';
  input?: unknown;
  output?: unknown;
  details?: unknown;
  isError?: boolean;
};
```

### FileEvent

```ts
type FileEvent = AppEventBase & {
  type: 'file';
  source: 'edit' | 'write' | 'bash-diff' | 'git';
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
};
```

### RunEvent

```ts
type RunEvent = AppEventBase & {
  type: 'run';
  phase: 'started' | 'running' | 'idle' | 'failed' | 'cancelled';
  model?: string;
  thinkingLevel?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
  toolStats?: {
    total: number;
    running: number;
    failed: number;
  };
};
```

---

## DiffModel 类型

```ts
type DiffModel = {
  files: DiffFile[];
};

type DiffFile = {
  path: string;
  oldPath?: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  large: boolean;
  generated: boolean;
  hunks: DiffHunk[];
};
```

---

## Extension Compatibility 类型

```ts
type CompatibilityLevel = 'native' | 'basic' | 'headless' | 'blocked';

interface DesktopPluginAdapter {
  id: string;
  displayName: string;
  compatibility: CompatibilityLevel;
  configSchema?: JsonSchema;
  defaultConfig?: unknown;
  renderers?: PluginRendererMap;
}
```

> **兼容层 v2 注记**：上述 `renderers`/`configSchema` 模型正被声明式 `adapter.json` + 预设原语取代（见 `docs/adapter-layer-plan.md`）。后续类型应按 `adapter.json` schema（config/toolCard/interact）重新表达，`tier` 不再赋予 trellis/ask 等插件留 native 专属组件的特权。

---

## Validation

### 运行时校验

使用 `zod` 或 `typebox` 校验：

- AppEvent：Worker 输出时校验，Renderer 接收时校验。
- IPC 请求/响应：Main Broker 校验。
- Remote registry JSON：加载时校验 schema + 签名。
- Extension config：JSON Schema Form 渲染前校验。

### IPC 请求响应 API

完整方法列表：

```ts
// Workspace
workspace.open();
workspace.switch();

// Session
session.list();
session.open();
session.new();
session.fork();
session.clone();
session.rename();
session.compact();
session.export();

// Prompt
prompt.send();
prompt.sendWithImages();
prompt.steer();
prompt.followUp();
prompt.abort();

// Model
model.list();
model.set();
model.cycle();
thinkingLevel.set();

// Commands
commands.list();

// Review
review.getDiff();

// Extensions
extensions.list();
extensions.setOverride();

// Registry
registry.refresh();

// Settings
settings.get();
settings.set();
```

Main 和 Worker 实现这些接口，Renderer 通过 `lib/ipc-client.ts` 调用。

---

## Common Patterns

- Union type + 字面量用 `as const`。
- 不确定的外部数据用 `unknown`，再用 type guard 或 zod 缩窄。
- 枚举值用 union string literal，不用 TS enum。

---

## Forbidden Patterns

| 模式 | 原因 |
|------|------|
| `any` | 绕过类型安全 |
| `as` 断言（非必要） | 隐藏类型错误 |
| TS enum | 用 union string literal 更安全 |
| inline type for props | 应该用 interface |
| Renderer 直接消费 pi SDK 原始事件 | 应该先转成 AppEvent |
| 不校验 remote registry JSON | 安全风险 |
