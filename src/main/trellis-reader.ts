// Trellis Reader - reads .trellis state in read-only mode

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

export interface TrellisState {
  hasTrellis: boolean
  currentTask?: {
    name: string
    status: string
    title: string
    priority?: string
  }
  phase?: string
  acceptanceCriteria?: string[]
  recentJournals?: { title: string; date: string; lines: number }[]
}

export function readTrellisState(cwd: string): TrellisState {
  const trellisDir = join(cwd, '.trellis')
  if (!existsSync(trellisDir)) {
    return { hasTrellis: false }
  }

  const state: TrellisState = { hasTrellis: true }

  // Try to get current task via script
  try {
    const output = execSync('python ./.trellis/scripts/task.py current', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    // task.py current outputs a path like ".trellis/tasks/06-19-xxx"
    const pathMatch = output.match(/tasks\/([^\s]+)/)
    if (pathMatch) {
      state.currentTask = {
        name: pathMatch[1],
        status: 'in_progress',
        title: pathMatch[1],
      }
    }

    // Try to read PRD for more info
    if (state.currentTask) {
      const prdPath = join(trellisDir, 'tasks', state.currentTask.name, 'prd.md')
      if (existsSync(prdPath)) {
        const prd = readFileSync(prdPath, 'utf-8')
        // Extract title from first heading
        const titleMatch = prd.match(/^#\s+(.+)$/m)
        if (titleMatch) {
          state.currentTask.title = titleMatch[1]
        }
        // Extract acceptance criteria
        const acSection = prd.match(/##\s+验收条件[\s\S]*?(?=##\s|$)/i) ||
                          prd.match(/##\s+Acceptance[\s\S]*?(?=##\s|$)/i)
        if (acSection) {
          const acLines = acSection[0]
            .split('\n')
            .filter((l) => l.match(/^\s*[-*]\s/) || l.match(/^AC\d+/))
            .map((l) => l.replace(/^\s*[-*]\s*/, '').replace(/^AC\d+:\s*/, '').trim())
            .filter((l) => l.length > 0)
          if (acLines.length > 0) {
            state.acceptanceCriteria = acLines.slice(0, 10)
          }
        }
      }
    }
  } catch (e) {
    // Script not available, try direct file reads
  }

  // Try to get phase
  try {
    const phaseOutput = execSync('python ./.trellis/scripts/get_context.py --mode phase', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    })
    const phaseMatch = phaseOutput.match(/Phase:\s*(\S+)/i) || phaseOutput.match(/阶段:\s*(\S+)/)
    if (phaseMatch) {
      state.phase = phaseMatch[1]
    }
  } catch (e) {
    // Phase not available
  }

  // Read recent journals (per-developer: .trellis/workspace/<developer>/*.md)
  try {
    const workspaceDir = join(trellisDir, 'workspace')
    if (existsSync(workspaceDir)) {
      const devs = readdirSync(workspaceDir).filter((d) => {
        try { return readdirSync(join(workspaceDir, d)).some((f) => f.endsWith('.md')) } catch { return false }
      })
      const journals: { file: string; dev: string; title: string; date: string; lines: number; mtime: number }[] = []
      for (const dev of devs) {
        const devDir = join(workspaceDir, dev)
        for (const f of readdirSync(devDir).filter((f) => f.endsWith('.md'))) {
          const filePath = join(devDir, f)
          const content = readFileSync(filePath, 'utf-8')
          const titleMatch = content.match(/^#\s+(.+)$/m)
          const stat = require('fs').statSync(filePath)
          journals.push({
            file: f,
            dev,
            title: titleMatch ? titleMatch[1] : f,
            date: f.replace('.md', ''),
            lines: content.split('\n').length,
            mtime: stat.mtimeMs,
          })
        }
      }
      state.recentJournals = journals.sort((a, b) => b.mtime - a.mtime).slice(0, 5)
    }
  } catch (e) {
    // Journals not available
  }

  return state
}
