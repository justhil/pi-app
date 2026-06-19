# Database Guidelines

> pi Desktop 本地存储规范。

---

## Overview

三层存储，pi session JSONL 是事实来源，App 不复制完整历史。

| 存储 | 用途 | 技术 |
|------|------|------|
| pi session JSONL | 聊天、工具调用、session tree、fork、compact | pi SDK 管理 |
| electron-store | 轻量配置 | JSON 文件 |
| SQLite | 索引缓存 | 本地数据库 |

---

## pi session JSONL

事实来源。App 不写入、不修改、不复制。

读取方式：通过 Pi Worker → pi SDK → SessionManager，不直接读文件。

---

## electron-store

存：

- 最近项目。
- 当前项目。
- 窗口大小。
- 主题选择。
- 面板宽度。
- extension 启用覆盖。
- extension 配置（App 私有兜底：adapter.json 未声明 configFile 时按 workspaceId + extensionId 存）。
- remote registry 更新时间。

配置结构示例：

```json
{
  "workspaceId": "D:/workspace/pi-app",
  "extensionId": "trellis",
  "config": {
    "showRecentJournal": true,
    "journalLimit": 5
  }
}
```

---

## SQLite

存索引缓存：

| 表 | 用途 |
|---|---|
| workspace_index | 项目元数据 |
| session_index | 会话索引（sessionId, workspaceId, name, createdAt） |
| run_index | 运行索引（runId, sessionId, status, model） |
| turn_index | 轮次索引（turnId, runId, sessionId） |
| file_change_index | 文件变更索引（path, turnId, sessionId, source, changeType） |
| extension_discovery | extension 探测结果 |
| registry_cache | remote registry 缓存元数据 |

### Query Patterns

- 按 workspaceId + sessionId + turnId 查询。
- 不做复杂 JOIN，索引够用就行。
- 写入时 upsert，避免重复。

### Naming Conventions

- 表名：snake_case（`session_index`）。
- 列名：snake_case（`workspace_id`、`session_id`）。
- 索引名：`idx_<table>_<columns>`。

---

## Migrations

- 第一版用简单 schema，不提前设计迁移系统。
- 后续如果 schema 变复杂，再加 migration 管理。

---

## Common Mistakes

- 在 App DB 里存完整聊天历史（应该用 pi session）。
- 直接读 JSONL 文件（应该走 Worker → SDK）。
- 把 electron-store 当查询引擎用（应该用 SQLite）。
- 不区分 workspace 写配置（应该按 workspaceId 隔离）。
