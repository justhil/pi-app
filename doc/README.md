# pi Desktop 扩展适配器文档（给 AI / 扩展作者）

本目录是 **pi Desktop 兼容层 v2** 的独立说明包，可整份复制给任意 AI，用于为 **pi npm 扩展** 编写或更新 **`adapter.json`**，无需阅读整个 pi-app 源码。

## 先读哪一份

| 文件 | 用途 |
|------|------|
| **[adapter-authoring-guide.md](./adapter-authoring-guide.md)** | **主文档**：从零写适配器、§1 外置覆盖内置、config / toolCard / 弹窗 / slash / 右栏、IPC、示例、模板、自检清单 |
| [adapter-layer-plan.md](./adapter-layer-plan.md) | 架构短文：A/B/C 分层、加载合并、原语一览、**右栏原语 workspace-trellis / workspace-tasks**、禁止事项 |

## 给 AI 的提示词（可直接粘贴）

```text
你是 pi Desktop 扩展适配器作者。只根据仓库 doc/adapter-authoring-guide.md（及必要时 doc/adapter-layer-plan.md）工作。

任务：为 npm 扩展「<包名>」编写或更新 adapter.json。
已知信息：<列出 registerTool 名、registerCommand、配置文件路径、是否会弹 ctx.ui 问卷/审图等>。

要求：
1. match.names 必须对齐扩展 package 名；tier 按实际桌面能力选择。
2. 外置文件放在 ~/.pi/desktop/adapters/ 或项目 .pi/desktop/adapters/ 时，按 match.names 整份覆盖内置，不是同 id 深合并（见指南 §1）。
3. 弹窗走通用 Extension UI；复杂参数用 interact + toolCard（见指南 §8）。
4. 禁止假设会在 pi-desktop 源码里加插件专用 IPC 或 if (pluginId)。
5. 右栏用 sidePanel 已注册键（任务布局：workspace-trellis + workspace-tasks，见指南 §10）。
6. 输出完整 JSON + 放置路径 + 验证步骤。

若信息不足，先列出需要从扩展 README/源码确认的项，再生成 adapter.json。
```

## 与 pi-desktop 应用的关系

- **内置**适配器在 pi-app 仓库 `src/extension-compat/builtin/*.adapter.json`。
- 本目录文档与实现同步维护；Schema 以 `adapter-schema.ts` 为准，文档冲突时以代码为准。
- 用户/项目外置 JSON 可 **不等 App 发版** 覆盖内置（按包名），见 authoring-guide **§1**；缓存与刷新见 **adapter-layer-plan.md §2.1–§2.2**。

## 存档与获取

- 与 [pi-app](https://github.com/justhil/pi-app) 同仓，路径 **`doc/`**。
- 仅需文档时：克隆仓库后只使用 `doc/` 目录，或从 GitHub 浏览 `doc/adapter-authoring-guide.md`。

---

*pi Desktop — pi 内核，桌面壳 + 声明式适配器。*