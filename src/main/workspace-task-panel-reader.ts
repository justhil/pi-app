// 兼容层原语：读取工作区 `.trellis/` 任务布局（stateProvider: workspace-trellis）

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export interface WorkspaceTaskRow {
  name: string
  title: string
  status: string
  priority?: string
  description?: string
  assignee?: string
  subtasks?: string[]
  acceptanceCriteria?: string[]
  isCurrent?: boolean
}

export interface WorkspaceTaskPanelState {
  /** 工作区存在可识别的任务目录布局 */
  ready: boolean
  layout: 'tasks'
  currentTaskName?: string
  tasks: WorkspaceTaskRow[]
  recentJournals?: { title: string; date: string; lines: number; preview: string }[]
}

function readTaskJson(rootDir: string, taskName: string): Record<string, unknown> | null {
  try {
    const p = join(rootDir, 'tasks', taskName, 'task.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch (e) {
    return null
  }
}

function readTaskPrd(
  rootDir: string,
  taskName: string,
): { title?: string; acceptanceCriteria?: string[]; description?: string } {
  try {
    const prdPath = join(rootDir, 'tasks', taskName, 'prd.md')
    if (!existsSync(prdPath)) return {}
    const prd = readFileSync(prdPath, 'utf-8')
    const titleMatch = prd.match(/^#\s+(.+)$/m)
    const acSection =
      prd.match(/##\s+验收条件[\s\S]*?(?=##\s|$)/i) ||
      prd.match(/##\s+Acceptance[\s\S]*?(?=##\s|$)/i) ||
      prd.match(/##\s+DoD[\s\S]*?(?=##\s|$)/i)
    let acceptanceCriteria: string[] | undefined
    if (acSection) {
      const acLines = acSection[0]
        .split('\n')
        .filter((l: string) => l.match(/^\s*[-*]\s/) || l.match(/^AC\d+/) || l.match(/^\d+\.\s/))
        .map((l: string) =>
          l
            .replace(/^\s*[-*]\s*/, '')
            .replace(/^AC\d+:\s*/, '')
            .replace(/^\d+\.\s*/, '')
            .trim(),
        )
        .filter((l: string) => l.length > 0)
      if (acLines.length > 0) acceptanceCriteria = acLines.slice(0, 8)
    }
    const descMatch = prd.match(/^#\s+.+\n+(.*?)(?=\n##\s|\n---|$)/s)
    const description = descMatch ? descMatch[1].trim().slice(0, 200) : undefined
    return { title: titleMatch?.[1], acceptanceCriteria, description }
  } catch (e) {
    return {}
  }
}

export function readWorkspaceTaskPanelState(cwd: string): WorkspaceTaskPanelState {
  const rootDir = join(cwd, '.trellis')
  if (!existsSync(rootDir)) {
    return { ready: false, layout: 'tasks', tasks: [] }
  }

  const state: WorkspaceTaskPanelState = { ready: true, layout: 'tasks', tasks: [] }

  let currentTaskName: string | undefined
  try {
    const output = execSync('python ./.trellis/scripts/task.py current', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    const pathMatch = output.match(/tasks\/([^\s]+)/)
    if (pathMatch) currentTaskName = pathMatch[1]
  } catch (e) {
    /* no current task */
  }
  state.currentTaskName = currentTaskName

  const tasksDir = join(rootDir, 'tasks')
  if (existsSync(tasksDir)) {
    const taskDirs = readdirSync(tasksDir).filter((d) => {
      const p = join(tasksDir, d)
      try {
        return statSync(p).isDirectory() && d !== 'archive'
      } catch (e) {
        return false
      }
    })

    for (const taskName of taskDirs) {
      const tj = readTaskJson(rootDir, taskName)
      const prd = readTaskPrd(rootDir, taskName)
      const isCurrent = taskName === currentTaskName
      state.tasks.push({
        name: taskName,
        title: prd.title || String(tj?.title ?? '') || taskName,
        status: String(tj?.status ?? '') || (isCurrent ? 'in_progress' : 'planning'),
        priority: tj?.priority as string | undefined,
        description: prd.description,
        assignee: tj?.assignee as string | undefined,
        subtasks: (tj?.children ?? tj?.subtasks) as string[] | undefined,
        acceptanceCriteria: prd.acceptanceCriteria,
        isCurrent,
      })
    }

    state.tasks.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      const pa = a.priority || 'P9'
      const pb = b.priority || 'P9'
      if (pa !== pb) return pa.localeCompare(pb)
      return a.name.localeCompare(b.name)
    })
  }

  try {
    const workspaceDir = join(rootDir, 'workspace')
    if (existsSync(workspaceDir)) {
      const devs = readdirSync(workspaceDir).filter((d) => {
        try {
          return readdirSync(join(workspaceDir, d)).some((f) => f.endsWith('.md'))
        } catch (e) {
          return false
        }
      })
      const journals: { title: string; date: string; lines: number; preview: string; mtime: number }[] = []
      for (const dev of devs) {
        const devDir = join(workspaceDir, dev)
        for (const f of readdirSync(devDir).filter((f) => f.endsWith('.md'))) {
          const filePath = join(devDir, f)
          const content = readFileSync(filePath, 'utf-8')
          const titleMatch = content.match(/^#\s+(.+)$/m)
          const lines = content.split('\n')
          const previewLine = lines.find(
            (l) =>
              l.trim() &&
              !l.startsWith('#') &&
              !l.startsWith('>') &&
              !l.startsWith('<!--') &&
              !l.startsWith('|') &&
              !l.startsWith('---'),
          )
          journals.push({
            title: titleMatch ? titleMatch[1] : f,
            date: f.replace('.md', ''),
            lines: lines.length,
            preview: previewLine ? previewLine.trim().slice(0, 80) : '',
            mtime: statSync(filePath).mtimeMs,
          })
        }
      }
      state.recentJournals = journals.sort((a, b) => b.mtime - a.mtime).slice(0, 5)
    }
  } catch (e) {
    /* journals optional */
  }

  return state
}