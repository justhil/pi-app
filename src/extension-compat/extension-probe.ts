// Extension Probe - inspects extension capabilities before formal Worker loads
// Scans .pi/extensions (project) and ~/.pi/agent/extensions (global)

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ExtensionProbeResult {
  id: string
  name: string
  description?: string
  source: 'project' | 'global'
  registeredTools: string[]
  registeredCommands: string[]
  hasUI: boolean
  compatibility: 'native' | 'basic' | 'headless' | 'blocked'
  adapterId?: string
  loadError?: string
}

// Built-in compatibility whitelist: tool name -> native adapter
// These are tools the desktop app has dedicated renderers for.
const TOOL_ADAPTERS: Record<string, string> = {
  trellis_subagent: 'trellis',
  ask_user_question: 'ask',
  image_gen: 'image',
  image_review: 'image',
  // Common pi ecosystem tools that map to generic but supported renderers
  browser_bridge: 'browser',
  web_scan: 'browser',
  web_execute_js: 'browser',
  analyze_image: 'image',
  preview_export: 'doc',
  studio_export_pdf: 'doc',
  studio_export_html: 'doc',
  intercom: 'intercom',
  studio_repl_send: 'repl',
  image_gen_config: 'image',
}

// UI-capable patterns that indicate TUI/interactive features
const UI_PATTERNS = [
  'ctx.ui', 'pi.ui', 'ctx.ui.custom', 'pi.ui.custom',
  'registerShortcut', 'setWidget', 'customComponent',
]

export function probeExtensions(cwd: string): ExtensionProbeResult[] {
  const results: ExtensionProbeResult[] = []
  const agentDir = join(homedir(), '.pi', 'agent')

  const probe = (dir: string, source: 'project' | 'global') => {
    if (!existsSync(dir)) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const name of entries) {
      const extPath = join(dir, name)
      let isDir: boolean
      try {
        isDir = statSync(extPath).isDirectory()
      } catch {
        continue
      }
      // Only directories and .ts/.js files are real extensions
      if (!isDir && !/\.(ts|js)$/.test(name)) continue
      // Skip non-extension stray files
      if (!isDir && /\.(json|md|bak)$/.test(name)) continue

      const id = name.replace(/\.(ts|js)$/, '')
      const result: ExtensionProbeResult = {
        id,
        name: id,
        source,
        registeredTools: [],
        registeredCommands: [],
        hasUI: false,
        compatibility: 'blocked',
      }

      // Find the source file
      const sourceFile = isDir
        ? (existsSync(join(extPath, 'index.ts'))
            ? join(extPath, 'index.ts')
            : existsSync(join(extPath, 'src', 'index.ts'))
              ? join(extPath, 'src', 'index.ts')
              : existsSync(join(extPath, 'index.js'))
                ? join(extPath, 'index.js')
                : null)
        : extPath

      if (sourceFile && existsSync(sourceFile)) {
        try {
          const src = readFileSync(sourceFile, 'utf-8')
          const parsed = parseExtensionSource(src, id, source, result)
          Object.assign(result, parsed)

          // Read package.json for name/description if it's a package
          if (isDir) {
            const pkgPath = join(extPath, 'package.json')
            if (existsSync(pkgPath)) {
              try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
                if (pkg.name) result.name = pkg.name
                if (pkg.description) result.description = pkg.description
              } catch {}
            }
          }
        } catch (e) {
          result.loadError = String(e)
        }
      }

      results.push(result)
    }
  }

  probe(join(cwd, '.pi', 'extensions'), 'project')
  probe(join(agentDir, 'extensions'), 'global')

  return results
}

function parseExtensionSource(
  src: string,
  _id: string,
  _source: 'project' | 'global',
  result: ExtensionProbeResult,
): ExtensionProbeResult {
  const tools = new Set<string>()
  const commands = new Set<string>()

  // Detect pi.registerTool({ name: "..." }) - object form
  for (const m of src.matchAll(/registerTool\??\s*\(\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/gs)) {
    tools.add(m[1])
  }
  // Detect pi.registerTool('name', ...) - string form
  for (const m of src.matchAll(/registerTool\??\s*\(\s*['"]([^'"]+)['"]/g)) {
    tools.add(m[1])
  }
  // Detect defineTool({ name: "..." })
  for (const m of src.matchAll(/defineTool\s*\(\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/gs)) {
    tools.add(m[1])
  }
  // Detect tools object: { name: "..." } inside arrays (customTools)
  for (const m of src.matchAll(/\bname:\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
    const candidate = m[1]
    // Only pick known tool-like names
    if (TOOL_ADAPTERS[candidate]) {
      tools.add(candidate)
    }
  }

  // Detect registerCommand calls
  for (const m of src.matchAll(/registerCommand\??\s*\(\s*['"]([^'"]+)['"]/g)) {
    commands.add(m[1])
  }

  result.registeredTools = Array.from(tools)
  result.registeredCommands = Array.from(commands)
  result.hasUI = UI_PATTERNS.some((p) => src.includes(p))

  // Determine compatibility level
  let bestLevel: ExtensionProbeResult['compatibility'] = 'blocked'
  for (const tool of result.registeredTools) {
    if (TOOL_ADAPTERS[tool]) {
      result.adapterId = TOOL_ADAPTERS[tool]
      bestLevel = 'native'
      break
    }
  }
  if (bestLevel === 'blocked') {
    if (result.registeredTools.length > 0 || result.registeredCommands.length > 0) {
      bestLevel = result.hasUI ? 'basic' : 'headless'
    } else if (result.hasUI) {
      bestLevel = 'basic'
    } else {
      // Has a source file but no detectable tools/commands - treat as headless (could provide context)
      bestLevel = 'headless'
    }
  }
  result.compatibility = bestLevel

  return result
}

// Map adapterId -> display label for UI
export const ADAPTER_LABELS: Record<string, string> = {
  trellis: 'Trellis',
  ask: 'Ask User',
  image: 'Image',
  browser: 'Browser',
  doc: 'Document',
  intercom: 'Intercom',
  repl: 'REPL',
}
