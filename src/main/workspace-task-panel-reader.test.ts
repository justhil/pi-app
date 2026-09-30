import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorkspaceTaskPanelState } from './workspace-task-panel-reader'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
it('recognizes an initialized task workspace even when it has no tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adapter-tasks-'))
  roots.push(root)
  await mkdir(join(root, '.trellis/tasks'), { recursive: true })
  expect(await readWorkspaceTaskPanelState(root)).toMatchObject({ ready: true, tasks: [] })
})
it('retains task metadata, acceptance criteria, current task and journals without invoking Python', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adapter-tasks-'))
  roots.push(root)
  for (const dir of ['tasks/check', '.runtime/sessions', 'workspace/test']) await mkdir(join(root, '.trellis', dir), { recursive: true })
  await writeFile(join(root, '.trellis/tasks/check/task.json'), JSON.stringify({ status: 'in_progress', priority: 'P1', assignee: 'test', children: ['child'] }))
  await writeFile(join(root, '.trellis/tasks/check/prd.md'), '# Task title\n\nDescription\n\n## 验收条件\n- Keep fields\nAC2: Keep current task\n\n## Other\n')
  await writeFile(join(root, '.trellis/.runtime/sessions/only.json'), JSON.stringify({ current_task: '.trellis/tasks/check' }))
  await writeFile(join(root, '.trellis/workspace/test/journal.md'), '# Journal title\n\nProgress\n')
  expect(await readWorkspaceTaskPanelState(root)).toMatchObject({ ready: true, currentTaskName: 'check', tasks: [{ name: 'check', title: 'Task title', status: 'in_progress', priority: 'P1', assignee: 'test', subtasks: ['child'], acceptanceCriteria: ['Keep fields', 'Keep current task'], isCurrent: true }], recentJournals: [{ title: 'Journal title', preview: 'Progress' }] })
})
