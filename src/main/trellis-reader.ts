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
    })
    // Parse output to find task name and status
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (line.includes('Current task')) {
        const match = line.match(/tasks\/([^\s]+)/)
        if (match) {
          state.currentTask = {
            name: match[1],
            status: 'in_progress',
            title: match[1],
          }
        }
      }
      if (line.includes('Status:')) {
        const statusMatch = line.match(/Status:\s*(\S+)/)
        if (statusMatch && state.currentTask) {
          state.currentTask.status = statusMatch[1]
        }
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

  // Read recent journals
  try {
    const journalDir = join(trellisDir, 'workspace', 'journal')
    if (existsSync(journalDir)) {
      const files = readdirSync(journalDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 5)
      state.recentJournals = files.map((f) => {
        const content = readFileSync(join(journalDir, f), 'utf-8')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        return {
          title: titleMatch ? titleMatch[1] : f,
          date: f.replace('.md', ''),
          lines: content.split('\n').length,
        }
      })
    }
  } catch (e) {
    // Journals not available
  }

  return state
}
