import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, resolve, dirname } from 'path'
import { homedir } from 'os'

const AGENT_DIR = join(homedir(), '.pi', 'agent')
const GLOBAL_SETTINGS = join(AGENT_DIR, 'settings.json')

export type PiResourceScope = 'user' | 'project'

export type PiExtensionToggleTarget =
  | {
      kind: 'package'
      scope: PiResourceScope
      source: string
      packageRoot: string
      /** paths relative to packageRoot, posix */
      resourcePaths: string[]
    }
  | {
      kind: 'top-level'
      scope: PiResourceScope
      absolutePath: string
      baseDir: string
    }

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function projectSettingsPath(cwd: string): string {
  return join(resolve(cwd), '.pi', 'settings.json')
}

function getSettingsFile(scope: PiResourceScope, cwd: string): string {
  return scope === 'project' ? projectSettingsPath(cwd) : GLOBAL_SETTINGS
}

function stripPatternPrefix(p: string): string {
  if (p.startsWith('!') || p.startsWith('+') || p.startsWith('-')) return p.slice(1)
  return p
}

function toPosixRel(baseDir: string, absPath: string): string {
  return relative(baseDir, absPath).split(/\\/g, '/')
}

function applyPatternToggle(
  current: string[],
  pattern: string,
  enabled: boolean,
): string[] {
  const disablePattern = `-${pattern}`
  const enablePattern = `+${pattern}`
  const updated = current.filter((p) => stripPatternPrefix(p) !== pattern)
  updated.push(enabled ? enablePattern : disablePattern)
  return updated
}

function toggleTopLevelExtensions(
  scope: PiResourceScope,
  cwd: string,
  absolutePath: string,
  baseDir: string,
  enabled: boolean,
): void {
  const path = getSettingsFile(scope, cwd)
  const settings = readJson(path)
  const pattern = toPosixRel(baseDir, absolutePath)
  const current = Array.isArray(settings.extensions) ? [...(settings.extensions as string[])] : []
  settings.extensions = applyPatternToggle(current, pattern, enabled)
  writeJson(path, settings)
}

function togglePackageExtensions(
  scope: PiResourceScope,
  cwd: string,
  source: string,
  packageRoot: string,
  resourcePaths: string[],
  enabled: boolean,
): void {
  const path = getSettingsFile(scope, cwd)
  const settings = readJson(path)
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : []
  const pkgIndex = packages.findIndex((pkg) => {
    const s = typeof pkg === 'string' ? pkg : (pkg as { source?: string })?.source
    return s === source
  })
  if (pkgIndex === -1) return

  let pkg: { source: string; extensions?: string[]; skills?: string[]; prompts?: string[]; themes?: string[] }
  const raw = packages[pkgIndex]
  if (typeof raw === 'string') {
    pkg = { source: raw }
  } else {
    pkg = { ...(raw as object), source: (raw as { source: string }).source } as typeof pkg
  }

  let extList = Array.isArray(pkg.extensions) ? [...pkg.extensions] : []
  for (const rel of resourcePaths) {
    const pattern = toPosixRel(packageRoot, resolve(packageRoot, rel))
    extList = applyPatternToggle(extList, pattern, enabled)
  }
  pkg.extensions = extList.length > 0 ? extList : undefined

  const hasFilters = ['extensions', 'skills', 'prompts', 'themes'].some(
    (k) => (pkg as Record<string, unknown>)[k] !== undefined,
  )
  packages[pkgIndex] = hasFilters ? pkg : pkg.source

  settings.packages = packages
  writeJson(path, settings)
}

export function setPiExtensionEnabled(
  cwd: string,
  target: PiExtensionToggleTarget,
  enabled: boolean,
): { ok: boolean; error?: string } {
  try {
    if (target.kind === 'top-level') {
      toggleTopLevelExtensions(target.scope, cwd, target.absolutePath, target.baseDir, enabled)
      return { ok: true }
    }
    togglePackageExtensions(
      target.scope,
      cwd,
      target.source,
      target.packageRoot,
      target.resourcePaths,
      enabled,
    )
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function isTopLevelExtensionEnabled(
  scope: PiResourceScope,
  cwd: string,
  absolutePath: string,
  baseDir: string,
): boolean {
  const settings = readJson(getSettingsFile(scope, cwd))
  const pattern = toPosixRel(baseDir, absolutePath)
  const current = Array.isArray(settings.extensions) ? (settings.extensions as string[]) : []
  let enabled = true
  for (const p of current) {
    const stripped = stripPatternPrefix(p)
    if (stripped !== pattern) continue
    if (p.startsWith('-')) enabled = false
    if (p.startsWith('+')) enabled = true
  }
  return enabled
}