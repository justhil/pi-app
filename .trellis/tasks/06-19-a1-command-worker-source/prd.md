# A1 命令系统重构-Worker权威源

## Goal

commands.list 权威源改为 Worker session get_commands(含pi内置命令+skills+prompts+extension commands)。废弃Main扫目录。Worker未启动时目录扫描仅作降级静态列表。依赖: docs/tui-replacement-and-adapters.md §2.2

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
