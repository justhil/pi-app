// Extension Probe - inspects extension capabilities
// Scans: .pi/extensions (project), ~/.pi/agent/extensions (global), pi packages

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'

export interface ExtensionProbeResult {
  id: string
  name: string
  description?: string
  version?: string
  source: 'project' | 'global' | 'package'
  packageName?: string
  registeredTools: string[]
  registeredCommands: string[]
  hasUI: boolean
  compatibility: 'native' | 'basic' | 'headless' | 'blocked'
  adapterId?: string
  /** All adapters matched by this package's tools */
  adapterIds?: string[]
  /** C-layer TUI-only decoration flag */
  tuiOnly?: boolean
  loadError?: string
  enabled: boolean
}

import { v2ToolMap, resolveV2ByPluginName } from './adapter-loader.js'

// Merged known-tools map from v2 adapter.json. Refreshed per probeExtensions() call.
let KNOWN_TOOLS: Record<string, string> = {}
// cwd for the current probe pass (avoids threading cwd through every helper).
let CURRENT_CWD = ''

function tierToCompatibility(tier: string): ExtensionProbeResult['compatibility'] {
  if (tier === 'native') return 'native'
  if (tier === 'partial') return 'basic'
  return 'headless'
}

/** Resolve adapter meta from v2 catalog (single source). tier 'none' => TUI-only decoration. */
function applyPluginAdapterFields(result: ExtensionProbeResult): void {
  const adapter = resolveV2ByPluginName(result.name, result.packageName, CURRENT_CWD)
  if (adapter && adapter.tier !== 'none') {
    const adapterName = result.packageName || result.name
    result.adapterId = adapterName
    result.adapterIds = [adapterName]
    result.compatibility = tierToCompatibility(adapter.tier)
    return
  }
  result.adapterId = undefined
  result.adapterIds = undefined
  if (adapter && adapter.tier === 'none') {
    result.compatibility = 'blocked'
    result.tuiOnly = true
    return
  }
  if (result.registeredTools.length || result.registeredCommands.length) {
    result.compatibility = result.hasUI ? 'basic' : 'headless'
  } else if (result.hasUI) {
    result.compatibility = 'basic'
  } else {
    result.compatibility = 'headless'
  }
}

const UI_PATTERNS = ['ctx.ui', 'pi.ui', 'registerShortcut', 'setWidget', 'customComponent', 'ctx.ui.custom', 'pi.ui.custom']

// Parse a single extension source file -> tools/commands/ui/compat
function parseExtensionSource(src: string, result: ExtensionProbeResult): void {
  const tools = new Set<string>()
  const commands = new Set<string>()

  for (const m of src.matchAll(/registerTool\??\s*\(\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/gs)) tools.add(m[1])
  for (const m of src.matchAll(/registerTool\??\s*\(\s*['"]([^'"]+)['"]/g)) tools.add(m[1])
  for (const m of src.matchAll(/defineTool\s*\(\s*\{[^}]*?name:\s*['"]([^'"]+)['"]/gs)) tools.add(m[1])
  // pick up known tool names from object literals
  for (const m of src.matchAll(/\bname:\s*['"]([a-z_][a-z0-9_]*)['"]/gi)) {
    if (KNOWN_TOOLS[m[1]]) tools.add(m[1])
  }
  for (const m of src.matchAll(/registerCommand\??\s*\(\s*['"]([^'"]+)['"]/g)) commands.add(m[1])

  result.registeredTools = Array.from(tools)
  result.registeredCommands = Array.from(commands)
  result.hasUI = UI_PATTERNS.some((p) => src.includes(p))

  applyPluginAdapterFields(result)
}

function readPackageJson(pkgDir: string): any | null {
  const p = join(pkgDir, 'package.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

function findGitPackageDirs(agentDir: string): string[] {
  const gitRoot = join(agentDir, 'git')
  if (!existsSync(gitRoot)) return []
  const dirs: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === '.git' || name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      let isDir = false
      try { isDir = statSync(full).isDirectory() } catch { continue }
      if (!isDir) continue
      if (existsSync(join(full, 'package.json'))) {
        dirs.push(full)
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(gitRoot, 0)
  return dirs
}

function resolveGitPackageDir(agentDir: string, repoName: string): string | null {
  for (const dir of findGitPackageDirs(agentDir)) {
    if (dir.endsWith(`/${repoName}`) || dir.endsWith(`\\${repoName}`)) return dir
    const pkg = readPackageJson(dir)
    if (pkg?.name === repoName) return dir
  }
  return null
}

// Find install dir: npm node_modules first, then ~/.pi/agent/git/<host>/<owner>/<repoName>
function resolvePackageDir(name: string, agentDir?: string): string | null {
  const nm = join(homedir(), '.pi', 'agent', 'npm', 'node_modules')
  const direct = join(nm, name)
  if (existsSync(direct) && statSync(direct).isDirectory()) return direct
  const ad = agentDir || join(homedir(), '.pi', 'agent')
  return resolveGitPackageDir(ad, name)
}

// Parse source string from settings.json package entries
function parsePackageSource(source: any): { type: 'npm' | 'git' | 'local'; name: string } | null {
  if (typeof source === 'string') {
    if (source.startsWith('npm:')) return { type: 'npm', name: source.slice(4) }
    if (source.startsWith('git:') || source.startsWith('http')) {
      // github.com/justhil/pi-image-gen -> pi-image-gen
      const m = source.match(/\/([^/]+?)(?:\.git)?$/)
      if (m) return { type: 'git', name: m[1] }
    }
    return { type: 'local', name: source }
  }
  return null
}

export function probeExtensions(cwd: string): ExtensionProbeResult[] {
  const results: ExtensionProbeResult[] = []
  const agentDir = join(homedir(), '.pi', 'agent')
  CURRENT_CWD = cwd

  // Refresh known-tools from v2 adapter.json for this project.
  try { KNOWN_TOOLS = { ...v2ToolMap(cwd) } } catch { KNOWN_TOOLS = {} }

  // 1. Scan project .pi/extensions
  scanExtDir(join(cwd, '.pi', 'extensions'), 'project', results)
  // 2. Scan global ~/.pi/agent/extensions
  scanExtDir(join(agentDir, 'extensions'), 'global', results)
  // 3. Scan pi packages from settings.json
  scanPackages(agentDir, results)

  // 4. Git clones under ~/.pi/agent/git (often not duplicated in settings.packages)
  scanGitClones(agentDir, results)

  return results
}

/** Probe git-installed packages even when missing from settings.packages (desktop visibility only). */
function scanGitClones(agentDir: string, results: ExtensionProbeResult[]) {
  const seen = new Set(results.flatMap((r) => [r.packageName, r.name].filter(Boolean) as string[]))
  for (const pkgDir of findGitPackageDirs(agentDir)) {
    const pkg = readPackageJson(pkgDir)
    if (!pkg) continue
    const repo = pkgDir.split(/[\\/]/).pop() || pkg.name
    const pkgName = pkg.name || repo
    if (seen.has(pkgName) || seen.has(repo)) continue
    const merged = buildPackageProbeResult(pkgDir, pkg, repo, undefined)
    if (!merged) continue
    merged.id = `git:${pkgDir.slice(join(agentDir, 'git').length + 1).replace(/\\/g, '/')}`
    merged.packageName = repo
    results.push(merged)
    seen.add(pkgName)
    seen.add(repo)
  }
}

function buildPackageProbeResult(
  pkgDir: string,
  pkg: any,
  parsedName: string,
  overrides: string[] | undefined,
): ExtensionProbeResult | null {
  let extFiles: string[] = []
  if (pkg.pi?.extensions && Array.isArray(pkg.pi.extensions)) {
    extFiles = pkg.pi.extensions
  } else if (pkg.main) {
    extFiles = [pkg.main]
  } else if (existsSync(join(pkgDir, 'index.ts'))) {
    extFiles = ['./index.ts']
  }

  const merged: ExtensionProbeResult = {
    id: `package:${parsedName}`,
    name: pkg.name || parsedName,
    description: pkg.description,
    version: pkg.version,
    source: 'package',
    packageName: parsedName,
    enabled: true,
    registeredTools: [],
    registeredCommands: [],
    hasUI: false,
    compatibility: 'blocked',
  }

  if (extFiles.length === 0) {
    scanPackageForKnownTools(pkgDir, merged)
    if (merged.registeredTools.length === 0 && merged.registeredCommands.length === 0 && !merged.hasUI) return null
    finalizeCompat(merged)
    return merged
  }

  const disabled = new Set<string>()
  for (const o of overrides || []) {
    if (o.startsWith('-')) disabled.add(o.replace(/^[-+]/, '').replace(/^\.\//, ''))
  }
  merged.enabled = extFiles.some((f) => !disabled.has(f.replace(/^\.\//, '')))

  for (const rel of extFiles) {
    const cleanRel = rel.replace(/^\.\//, '')
    if (disabled.has(cleanRel)) continue
    const fullPath = resolve(pkgDir, cleanRel)
    if (!existsSync(fullPath)) continue
    try {
      if (statSync(fullPath).isDirectory()) continue
    } catch { continue }
    try {
      const src = readFileSync(fullPath, 'utf-8')
      const tmp: ExtensionProbeResult = {
        id: '', name: '', source: 'package', enabled: true,
        registeredTools: [], registeredCommands: [], hasUI: false, compatibility: 'blocked',
      }
      parseExtensionSource(src, tmp)
      mergeResult(merged, tmp)
    } catch { /* ignore */ }
  }
  scanPackageForKnownTools(pkgDir, merged)
  finalizeCompat(merged)
  return merged
}

function scanExtDir(dir: string, source: 'project' | 'global', results: ExtensionProbeResult[]) {
  if (!existsSync(dir)) return
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }

  for (const name of entries) {
    const extPath = join(dir, name)
    let isDir = false
    try { isDir = statSync(extPath).isDirectory() } catch { continue }
    if (!isDir && !/\.(ts|js|mjs)$/.test(name)) continue
    if (!isDir && /\.(json|md|bak|d\.ts)$/.test(name)) continue

    const id = `${source}:${name.replace(/\.(ts|js|mjs)$/, '')}`
    const result: ExtensionProbeResult = {
      id, name: name.replace(/\.(ts|js|mjs)$/, ''), source, enabled: true,
      registeredTools: [], registeredCommands: [], hasUI: false, compatibility: 'blocked',
    }

    const sourceFile = isDir
      ? (existsSync(join(extPath, 'index.ts')) ? join(extPath, 'index.ts')
        : existsSync(join(extPath, 'src', 'index.ts')) ? join(extPath, 'src', 'index.ts')
        : existsSync(join(extPath, 'index.js')) ? join(extPath, 'index.js') : null)
      : extPath

    if (sourceFile && existsSync(sourceFile)) {
      try {
        parseExtensionSource(readFileSync(sourceFile, 'utf-8'), result)
        if (isDir) {
          const pkg = readPackageJson(extPath)
          if (pkg?.name) result.name = pkg.name
          if (pkg?.description) result.description = pkg.description
          if (pkg?.version) result.version = pkg.version
        }
      } catch (e) { result.loadError = String(e) }
    }
    results.push(result)
  }
}

function scanPackages(agentDir: string, results: ExtensionProbeResult[]) {
  const settingsPath = join(agentDir, 'settings.json')
  if (!existsSync(settingsPath)) return
  let settings: any
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) } catch { return }

  const packages = settings.packages || []
  if (!Array.isArray(packages)) return

  for (const entry of packages) {
    // entry can be a string ("npm:foo") or { source: "npm:foo", extensions: ["+index.ts", "-x.ts"], ... }
    let sourceStr: string
    let overrides: string[] | undefined
    if (typeof entry === 'string') {
      sourceStr = entry
    } else if (entry && typeof entry === 'object') {
      sourceStr = entry.source
      overrides = entry.extensions
    } else {
      continue
    }

    const parsed = parsePackageSource(sourceStr)
    if (!parsed) continue

    const pkgDir = resolvePackageDir(parsed.name, agentDir)
    if (!pkgDir) continue

    const pkg = readPackageJson(pkgDir)
    if (!pkg) continue

    const merged = buildPackageProbeResult(pkgDir, pkg, parsed.name, overrides)
    if (merged) results.push(merged)
  }
}

function mergeResult(merged: ExtensionProbeResult, tmp: ExtensionProbeResult): void {
  tmp.registeredTools.forEach((t) => { if (!merged.registeredTools.includes(t)) merged.registeredTools.push(t) })
  tmp.registeredCommands.forEach((c) => { if (!merged.registeredCommands.includes(c)) merged.registeredCommands.push(c) })
  if (tmp.hasUI) merged.hasUI = true
  applyPluginAdapterFields(merged)
}

function finalizeCompat(merged: ExtensionProbeResult): void {
  applyPluginAdapterFields(merged)
}

// Recursively scan a package dir for known tool/command names and UI patterns
function scanPackageForKnownTools(pkgDir: string, merged: ExtensionProbeResult): void {
  let files: string[] = []
  try {
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        const full = join(d, name)
        let st
        try { st = statSync(full) } catch { continue }
        if (st.isDirectory()) walk(full)
        else if (/\.(ts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\./.test(name) && !/\.spec\./.test(name)) files.push(full)
      }
    }
    walk(pkgDir)
  } catch { return }

  for (const f of files.slice(0, 60)) { // cap scan
    try {
      const src = readFileSync(f, 'utf-8')
      // match known tool names
      for (const toolName of Object.keys(KNOWN_TOOLS)) {
        const re = new RegExp(`(['\""])${toolName}\\1`, 'g')
        if (re.test(src) && !merged.registeredTools.includes(toolName)) {
          merged.registeredTools.push(toolName)
        }
      }
      if (UI_PATTERNS.some((p) => src.includes(p))) merged.hasUI = true
    } catch {}
  }
}

