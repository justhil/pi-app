# 本地存储 electron-store + SQLite

## Goal
实现三层存储中的 App 本地存储层。

## Requirements
- electron-store 封装（config-store.ts）。
- SQLite 索引封装（sqlite-index.ts）。
- electron-store 存：最近项目、当前项目、窗口大小、主题、面板宽度、extension 覆盖、registry 时间。
- SQLite 表：workspace_index, session_index, run_index, turn_index, file_change_index, extension_discovery, registry_cache。
- upsert 写入模式。
- 配置按 workspaceId 隔离。

## Acceptance Criteria
- [ ] electron-store 能读写配置。
- [ ] SQLite 能创建表和 upsert。
- [ ] 按 workspaceId 查询配置正确隔离。
- [ ] pi session JSONL 不被 App 写入。

## Dependencies
- electron-main, scaffold。
