// Extension Probe - inspects extension capabilities before formal Worker loads

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ExtensionProbeResult {
  id: string
  name: string
  source: 'project' | 'global'
  registeredTools: string[]
  registeredCommands: string[]
  hasUI: boolean
  compatibility: 'native' | 'basic' | 'headless' | 'blocked'
  adapterId?: string
}

// Built-in compatibility whitelist: tool name -> adapter
const TOOL_ADAPTERS: Record<string, string> = {
  trellis_subagent: 'trellis',
  ask_user_question: 'ask',
  image_gen: 'image',
  image_review: 'image',
}

// Commands that indicate UI capability
const UI_COMMANDS = ['select', 'confirm', 'input', 'editor', 'custom']

export function probeExtensions(cwd: string): ExtensionProbeResult[] {
  const results: ExtensionProbeResult[] = []
  const agentDir = join(homedir(), '.pi', 'agent')

  const probe = (dir: string, source: 'project' | 'global') => {
    if (!existsSync(dir)) return
    try {
      for (const name of readdirSync(dir)) {
        const extPath = join(dir, name)
        if (!statSync(extPath).isDirectory() && !name.endsWith('.ts')) continue

        const id = name.replace(/\.ts$/, '')
        const result: ExtensionProbeResult = {
          id,
          name: id,
          source,
          registeredTools: [],
          registeredCommands: [],
          hasUI: false,
          compatibility: 'blocked',
        }

        // Read extension source to detect tools and commands
        const sourceFile = name.endsWith('.ts')
          ? extPath
          : join(extPath, 'index.ts')

        if (existsSync(sourceFile)) {
          try {
            const src = readFileSync(sourceFile, 'utf-8')
            // Detect registerTool calls
            const toolMatches = src.matchAll(/registerTool\s*\(\s*['"]([^'"]+)['"]/g)
            for (const m of toolMatches) {
              result.registeredTools.push(m[1])
            }
            // Detect pi.registerTool pattern
            const toolMatches2 = src.matchAll(/name:\s*['"]([^'"]+)['"]/g)
            for (const m of toolMatches2) {
              const toolName = m[1]
              if (TOOL_ADAPTERS[toolName] && !result.registeredTools.includes(toolName)) {
                result.registeredTools.push(toolName)
              }
            }
            // Detect registerCommand calls
            const cmdMatches = src.matchAll(/registerCommand\s*\(\s*['"]([^'"]+)['"]/g)
            for (const m of cmdMatches) {
              result.registeredCommands.push(m[1])
            }
            // Detect UI usage
            if (src.includes('ctx.ui') || src.includes('pi.ui')) {
              result.hasUI = true
            }
          } catch {}
        }

        // Determine compatibility
        for (const tool of result.registeredTools) {
          if (TOOL_ADAPTERS[tool]) {
            result.compatibility = 'native'
            result.adapterId = TOOL_ADAPTERS[tool]
            break
          }
        }
        if (result.compatibility === 'blocked' && result.registeredTools.length > 0) {
          result.compatibility = 'basic'
        }
        if (result.compatibility === 'blocked' && result.hasUI) {
          result.compatibility = 'basic'
        }

        results.push(result)
      }
    } catch {}
  }

  probe(join(cwd, '.pi', 'extensions'), 'project')
  probe(join(agentDir, 'extensions'), 'global')

  return results
}
