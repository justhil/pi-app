# A3 A层命令执行语义

## Goal

按category分流执行: builtin走对应IPC(/model→model.set/cycle,/think→thinkingLevel.set); /skill:/prompt:展开模板可预览可编辑再发; 扩展命令走pi command API。禁止把/model当普通prompt文本。依赖A1。依赖: tui-replacement-and-adapters.md §2.4

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
