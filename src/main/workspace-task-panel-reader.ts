import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

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
  ready: boolean
  layout: 'tasks'
  currentTaskName?: string
  tasks: WorkspaceTaskRow[]
  recentJournals?: { title: string; date: string; lines: number; preview: string }[]
}

async function textFile(path: string): Promise<string> {
  try {
    if ((await stat(path)).size > 1024 * 1024) return ''
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

export async function readWorkspaceTaskPanelState(cwd: string): Promise<WorkspaceTaskPanelState> {
  const root = join(cwd, '.trellis')
  const taskDirs = await readdir(join(root, 'tasks'), { withFileTypes: true }).catch(() => [])
  const state: WorkspaceTaskPanelState = { ready: (await stat(root).catch(() => null))?.isDirectory() ?? false, layout: 'tasks', tasks: [] }
  const sessionsDir = join(root, '.runtime', 'sessions')
  const sessions = (await readdir(sessionsDir).catch(() => [])).filter((name) => name.endsWith('.json'))
  const key = process.env.TRELLIS_CONTEXT_ID || (process.env.PI_SESSION_ID ? `pi_${process.env.PI_SESSION_ID}` : '')
  const activeFile = key && sessions.includes(`${key}.json`) ? `${key}.json` : sessions.length === 1 ? sessions[0] : undefined
  if (activeFile) {
    try {
      const pointer = JSON.parse(await textFile(join(sessionsDir, activeFile))) as { current_task?: string }
      state.currentTaskName = pointer.current_task?.replace(/\\/g, '/').match(/tasks\/([^/\s]+)$/)?.[1]
    } catch { /* optional current-task hint */ }
  }
  for (const dir of taskDirs.filter((entry) => entry.isDirectory() && entry.name !== 'archive').slice(0, 200)) {
    const folder = join(root, 'tasks', dir.name)
    const [metaText, prd] = await Promise.all([textFile(join(folder, 'task.json')), textFile(join(folder, 'prd.md'))])
    let meta: Record<string, unknown> = {}
    try { meta = JSON.parse(metaText) } catch { /* optional metadata */ }
    const acceptance = prd.match(/##\s+(?:验收条件|Acceptance[^\n]*|DoD)[\s\S]*?(?=\n##\s|$)/i)?.[0]
    const isCurrent = dir.name === state.currentTaskName
    state.tasks.push({
      name: dir.name,
      title: prd.match(/^#\s+(.+)$/m)?.[1] || String(meta.title || dir.name),
      status: String(meta.status || (isCurrent ? 'in_progress' : 'planning')),
      priority: typeof meta.priority === 'string' ? meta.priority : undefined,
      assignee: typeof meta.assignee === 'string' ? meta.assignee : undefined,
      description: prd.match(/^#\s+.+\n+(.*?)(?=\n##\s|\n---|$)/s)?.[1].trim().slice(0, 200),
      subtasks: Array.isArray(meta.children ?? meta.subtasks) ? (meta.children ?? meta.subtasks) as string[] : undefined,
      acceptanceCriteria: acceptance?.split('\n').filter((line) => /^\s*(?:[-*]|\d+\.|AC\d+:)\s*/.test(line)).map((line) => line.replace(/^\s*(?:[-*]|\d+\.|AC\d+:)\s*/, '').trim()).slice(0, 8),
      isCurrent,
    })
  }
  state.tasks.sort((a, b) => Number(!!b.isCurrent) - Number(!!a.isCurrent) || (a.priority ?? 'P9').localeCompare(b.priority ?? 'P9') || a.name.localeCompare(b.name))
  const journals: NonNullable<WorkspaceTaskPanelState['recentJournals']>[number][] = []
  const files: { path: string; name: string; modified: number }[] = []
  const developers = await readdir(join(root, 'workspace'), { withFileTypes: true }).catch(() => [])
  for (const dev of developers.filter((entry) => entry.isDirectory()).slice(0, 40)) {
    const folder = join(root, 'workspace', dev.name)
    const names = await readdir(folder).catch(() => [])
    for (const name of names.filter((entry) => entry.endsWith('.md')).slice(0, 100)) {
      const path = join(folder, name)
      const info = await stat(path).catch(() => null)
      if (info?.isFile()) files.push({ path, name, modified: info.mtimeMs })
    }
  }
  for (const file of files.sort((a, b) => b.modified - a.modified).slice(0, 20)) {
    const text = await textFile(file.path)
    const lines = text.split('\n')
    journals.push({ title: text.match(/^#\s+(.+)$/m)?.[1] ?? file.name, date: file.name.replace(/\.md$/, ''), lines: lines.length, preview: lines.find((line) => line.trim() && !/^(#|>|<!--|\||---)/.test(line))?.trim().slice(0, 80) ?? '' })
  }
  state.recentJournals = journals
  return state
}
