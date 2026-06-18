# Hook Guidelines

> pi Desktop 自定义 Hook 模式和 IPC 数据获取。

---

## Overview

前端不直接访问 Node、fs、pi SDK、Worker。所有数据通过 typed IPC 获取，所有实时更新通过 AppEvent 流驱动。

---

## Custom Hook Patterns

### IPC 请求类 Hook

用 TanStack Query（可选）或自定义 hook 封装 IPC 调用。

```ts
// 示例：获取会话列表
function useSessionList(workspaceId: string) {
  return useQuery({
    queryKey: ['sessions', workspaceId],
    queryFn: () => ipcClient.session.list(workspaceId),
  });
}
```

### AppEvent 流类 Hook

订阅 AppEvent，按类型分发到 UI 状态。

```ts
// 示例：订阅当前 run 的事件
function useRunEvents(runId: string) {
  const [events, setEvents] = useState<AppEvent[]>([]);
  useEffect(() => {
    const unsubscribe = ipcClient.events.subscribe((event) => {
      if (event.runId === runId) {
        setEvents((prev) => [...prev, event]);
      }
    });
    return unsubscribe;
  }, [runId]);
  return events;
}
```

### 命名

- `use` 前缀。
- IPC 请求：`useXxxList`、`useXxxDetail`。
- 事件流：`useXxxEvents`、`useXxxStream`。
- UI 状态：`useXxxState`、`useXxxPanel`。

---

## Data Fetching

### 获取列表/详情

通过 IPC 请求响应 API：

```text
workspace.open()
workspace.switch()
session.list()
session.open()
session.new()
review.getDiff()
extensions.list()
settings.get()
```

### 实时更新

通过事件流：

```text
events.subscribe((event: AppEvent) => {})
```

AppEvent 四类：

| 类型 | 用途 |
|------|------|
| message | Timeline 消息 |
| tool | Timeline 工具卡 / Run 统计 |
| file | Review 文件变更 |
| run | Run 面板状态 |

### 事件序号

所有 AppEvent 带 `seq` 字段。Renderer 发现断号时请求快照：

```ts
runtime.getSnapshot()
```

---

## Common Mistakes

- 在 Renderer 里直接 `import` Node 模块（应该走 IPC）。
- 在 Renderer 里直接 `import` pi SDK（应该走 Worker + AppEvent）。
- 在 hook 里不做 cleanup（subscribe 必须返回 unsubscribe）。
- 把 SDK 原始事件直接塞进 UI（应该先转成 AppEvent）。
