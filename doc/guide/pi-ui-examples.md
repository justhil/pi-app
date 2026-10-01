# pi-ui 示例

以下是结构化内容的格式示例，数据仅用于演示和自动化测试，不代表实际业务或项目指标。

## 指标

```pi-ui
{
  "component": "stat-grid",
  "id": "q3-kpis",
  "props": {
    "title": "Q3 核心指标",
    "periods": ["4月", "5月", "6月", "7月", "8月", "9月"],
    "items": [
      { "label": "营收", "value": "¥1.28M", "delta": "+12.4%", "note": "环比", "history": [0.92, 0.98, 1.05, 1.1, 1.14, 1.28] },
      { "label": "活跃用户", "value": "48,210", "delta": "+3.1%", "history": [41000, 42800, 44100, 45900, 46750, 48210] },
      { "label": "流失率", "value": "2.4", "unit": "%", "delta": "-0.6pt", "trend": "up", "note": "越低越好" },
      { "label": "工单平均响应", "value": "3.2", "unit": "小时", "delta": "+0.4", "trend": "down" }
    ]
  }
}
```

## 柱状图与折线图

```pi-ui
{
  "component": "chart",
  "id": "orders-vs-conversion",
  "props": {
    "title": "订单量与转化率",
    "type": "bar",
    "x": ["1月", "2月", "3月", "4月", "5月", "6月"],
    "series": [
      { "name": "订单量", "data": [820, 932, 901, 1134, 1290, 1330] },
      { "name": "转化率", "type": "line", "axis": "right", "data": [2.1, 2.4, 2.2, 2.9, 3.1, 3.3] }
    ],
    "unit": "单",
    "rightUnit": "%"
  }
}
```

## 环形图

```pi-ui
{
  "component": "chart",
  "id": "traffic-sources",
  "props": {
    "title": "流量来源",
    "type": "donut",
    "x": ["自然搜索", "直接访问", "社交媒体", "广告", "其他"],
    "series": [{ "name": "访问量", "data": [4200, 2600, 1800, 1200, 400] }]
  }
}
```

## 表格

```pi-ui
{
  "component": "data-table",
  "id": "dep-audit",
  "props": {
    "title": "依赖体积审计",
    "columns": [
      { "key": "name", "label": "包" },
      { "key": "version", "label": "版本" },
      { "key": "size", "label": "体积 (KB)", "type": "number" },
      { "key": "treeShakable", "label": "可摇树", "type": "boolean" }
    ],
    "rows": [
      { "name": "react-dom", "version": "18.3.1", "size": 131.9, "treeShakable": false },
      { "name": "katex", "version": "0.16.11", "size": 276.4, "treeShakable": false },
      { "name": "zustand", "version": "5.0.2", "size": 1.2, "treeShakable": true }
    ]
  }
}
```

## 卡片列表

```pi-ui
{
  "component": "card-grid",
  "id": "reading-list",
  "props": {
    "title": "推荐阅读",
    "items": [
      { "title": "React 18 并发渲染", "summary": "transition 与 Suspense 如何协同工作。", "tag": "React", "source": "react.dev", "url": "https://react.dev/blog/2022/03/29/react-v18" },
      { "title": "CSS 合成层与动画性能", "summary": "为什么只动画 transform 与 opacity。", "tag": "CSS", "source": "web.dev", "url": "https://web.dev/articles/animations-guide" },
      { "title": "Electron 进程模型", "summary": "主进程、渲染进程与 preload。", "tag": "Electron" }
    ]
  }
}
```

## 代码差异

```pi-ui
{
  "component": "diff",
  "id": "retry-fix",
  "props": {
    "title": "重试逻辑修复",
    "language": "ts",
    "before": "async function fetchWithRetry(url) {\n  for (let i = 0; i < 3; i++) {\n    const res = await fetch(url)\n    if (res.ok) return res\n  }\n}",
    "after": "async function fetchWithRetry(url, attempts = 3) {\n  for (let i = 0; i < attempts; i++) {\n    const res = await fetch(url)\n    if (res.ok) return res\n    await sleep(2 ** i * 200)\n  }\n  throw new Error(`failed after ${attempts} attempts`)\n}"
  }
}
```

## 决策树

```pi-ui
{
  "component": "decision-tree",
  "id": "app-wont-start",
  "props": {
    "title": "应用无法启动排查",
    "nodes": [
      { "id": "start", "text": "启动时有报错窗口吗？", "options": [ { "label": "有报错", "next": "error" }, { "label": "没有反应", "next": "silent" } ] },
      { "id": "error", "text": "报错里提到端口被占用吗？", "options": [ { "label": "是", "next": "port" }, { "label": "不是", "next": "logs" } ] },
      { "id": "silent", "text": "任务管理器里有残留进程吗？", "options": [ { "label": "有", "next": "kill" }, { "label": "没有", "next": "logs" } ] },
      { "id": "port", "text": "释放端口后重启", "detail": "检查端口占用进程后重启应用。" },
      { "id": "kill", "text": "结束残留进程后重启", "detail": "旧实例持有单实例锁时新实例会直接退出。" },
      { "id": "logs", "text": "查看日志定位", "detail": "查看应用日志的最后 50 行，分享前先移除敏感信息。" }
    ]
  }
}
```

## 测验

```pi-ui
{
  "component": "quiz",
  "id": "js-event-loop",
  "props": {
    "title": "事件循环小测",
    "questions": [
      {
        "question": "Promise.then 的回调属于哪类任务？",
        "options": ["宏任务", "微任务", "渲染任务", "空闲任务"],
        "answer": 1,
        "explanation": "then/catch/finally 回调进入微任务队列，在当前宏任务结束后立即执行。"
      },
      {
        "question": "以下哪些会产生宏任务？",
        "options": ["setTimeout", "queueMicrotask", "MessageChannel", "MutationObserver"],
        "answer": [0, 2],
        "explanation": "setTimeout 与 MessageChannel 是宏任务；另外两个是微任务。"
      }
    ]
  }
}
```

## 甘特图

```pi-ui
{
  "component": "gantt",
  "id": "v06-plan",
  "props": {
    "title": "示例版本排期",
    "tasks": [
      { "id": "design", "name": "交互设计", "group": "设计", "start": "2026-10-08", "end": "2026-10-12", "progress": 100 },
      { "id": "spec", "name": "技术方案", "group": "设计", "start": "2026-10-10", "duration": 4, "progress": 60, "dependsOn": "design" },
      { "id": "fe", "name": "前端实现", "group": "开发", "start": "2026-10-14", "end": "2026-10-24", "progress": 20, "dependsOn": ["spec"] },
      { "id": "be", "name": "后端接口", "group": "开发", "start": "2026-10-14", "end": "2026-10-21", "dependsOn": "spec" },
      { "id": "qa", "name": "联调测试", "start": "2026-10-25", "duration": 4, "dependsOn": ["fe", "be"] },
      { "id": "ship", "name": "发布", "start": "2026-10-30", "milestone": true, "dependsOn": "qa" }
    ]
  }
}
```
