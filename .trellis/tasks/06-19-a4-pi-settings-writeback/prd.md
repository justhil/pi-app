# A4 Pi原生设置页与settings写回

## Goal

Pi配置设置页: 读~/.pi/agent/settings.json+.pi/settings.json,改动经Worker SettingsManager写回(全局或项目级)。覆盖旧约束App不改pi全局配置。字段:默认模型defaultProvider/defaultModel,sessionDir,packages路径展示,compaction,retry,transport,steer模式,enabledModels。安全红线:只改pi官方字段,不手写JSON。依赖: tui-replacement-and-adapters.md §2.5

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
