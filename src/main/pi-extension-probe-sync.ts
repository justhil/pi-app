import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { ExtensionProbeResult } from '../extension-compat/extension-probe.js'
import type { PiExtensionToggleTarget } from './pi-package-resource-toggle.js'
import { isTopLevelExtensionEnabled } from './pi-package-resource-toggle.js'
import { readGlobalSettingsJson } from './pi-skill-overrides'

function stripPatternPrefix(p: string): string {
  if (p.startsWith('!') || p.startsWith('+') || p.startsWith('-')) return p.slice(1)
  return p
}

function isPathEnabledByPatterns(patterns: string[] | undefined, pattern: string): boolean {
  if (!patterns?.length) return true
  let enabled = true
  for (const p of patterns) {
    if (stripPatternPrefix(p) !== pattern) continue
    if (p.startsWith('-')) enabled = false
    if (p.startsWith('+')) enabled = true
  }
  return enabled
}

function readProjectSettings(cwd: string): Record<string, unknown> {
  const p = join(resolve(cwd), '.pi', 'settings.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

function packageEntrySource(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && 'source' in entry) return String((entry as { source: string }).source)
  return null
}

function findPackageEntry(
  settings: Record<string, unknown>,
  source: string,
): { source: string; extensions?: string[] } | null {
  const packages = settings.packages
  if (!Array.isArray(packages)) return null
  for (const entry of packages) {
    const s = packageEntrySource(entry)
    if (s !== source) continue
    if (typeof entry === 'string') return { source: entry }
    return entry as { source: string; extensions?: string[] }
  }
  return null
}

function collectLoadedExtensionRelPaths(
  pkgDir: string,
  pkg: { pi?: { extensions?: string[] }; main?: string },
  overrides: string[] | undefined,
): string[] {
  let extFiles: string[] = []
  if (pkg.pi?.extensions && Array.isArray(pkg.pi.extensions)) {
    extFiles = pkg.pi.extensions
  } else if (pkg.main) {
    extFiles = [pkg.main]
  } else if (existsSync(join(pkgDir, 'index.ts'))) {
    extFiles = ['./index.ts']
  }

  const disabled = new Set<string>()
  for (const o of overrides || []) {
    if (o.startsWith('-')) disabled.add(stripPatternPrefix(o).replace(/^\.\//, ''))
  }

  const out: string[] = []
  for (const rel of extFiles) {
    const clean = rel.replace(/^\.\//, '')
    if (disabled.has(clean)) continue
    const full = resolve(pkgDir, rel)
    if (!existsSync(full)) continue
    try {
      if (statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    out.push(clean)
  }
  return out
}

function packageEnabledFromSettings(
  pkgDir: string,
  pkg: { pi?: { extensions?: string[] }; main?: string },
  overrides: string[] | undefined,
): boolean {
  const paths = collectLoadedExtensionRelPaths(pkgDir, pkg, overrides)
  if (paths.length === 0) {
    const extFiles =
      pkg.pi?.extensions && Array.isArray(pkg.pi.extensions)
        ? pkg.pi.extensions
        : pkg.main
          ? [pkg.main]
          : ['./index.ts']
    const disabled = new Set<string>()
    for (const o of overrides || []) {
      if (o.startsWith('-')) disabled.add(stripPatternPrefix(o).replace(/^\.\//, ''))
    }
    return extFiles.some((f) => !disabled.has(f.replace(/^\.\//, '')))
  }
  for (const rel of paths) {
    const pattern = rel.split(/\\/g).join('/')
    if (!isPathEnabledByPatterns(overrides, pattern)) return false
  }
  return true
}

export function applyPiSyncToExtensionProbes(cwd: string, probes: ExtensionProbeResult[]): void {
  const resolvedCwd = resolve(cwd)
  const agentDir = join(homedir(), '.pi', 'agent')
  const globalSettings = readGlobalSettingsJson()
  const projectSettings = readProjectSettings(resolvedCwd)

  for (const ext of probes) {
    if (ext.source === 'package') {
      if (!ext.inSettingsPackages || !ext.packageSource || !ext.packageRoot) {
        ext.piSync = false
        ext.piEnabled = ext.enabled
        continue
      }
      const scope: 'project' | 'user' = 'user'
      const settings = globalSettings
      const entry = findPackageEntry(settings, ext.packageSource)
      const overrides = entry?.extensions
      const pkg = readPackageJsonSafe(ext.packageRoot)
      if (!pkg) {
        ext.piSync = true
        ext.piEnabled = ext.enabled
        continue
      }
      const resourcePaths = collectLoadedExtensionRelPaths(ext.packageRoot, pkg, overrides)
      const piEnabled = packageEnabledFromSettings(ext.packageRoot, pkg, overrides)
      ext.piSync = true
      ext.piScope = scope
      ext.piEnabled = piEnabled
      ext.enabled = piEnabled
      ext.packageResourcePaths = resourcePaths
      ext.toggleTarget = {
        kind: 'package',
        scope,
        source: ext.packageSource,
        packageRoot: ext.packageRoot,
        resourcePaths,
      }
      continue
    }

    if (ext.source === 'project' || ext.source === 'global') {
      const scope = ext.source === 'project' ? 'project' : ('user' as const)
      const baseDir =
        ext.source === 'project' ? join(resolvedCwd, '.pi', 'extensions') : join(agentDir, 'extensions')
      const absPath = ext.mainFilePath
      if (!absPath) {
        ext.piSync = false
        ext.piEnabled = true
        continue
      }
      const piEnabled = isTopLevelExtensionEnabled(scope, resolvedCwd, absPath, baseDir)
      ext.piSync = true
      ext.piScope = scope
      ext.piEnabled = piEnabled
      ext.enabled = piEnabled
      ext.toggleTarget = {
        kind: 'top-level',
        scope,
        absolutePath: absPath,
        baseDir,
      }
    }
  }
}

function readPackageJsonSafe(dir: string): { pi?: { extensions?: string[] }; main?: string } | null {
  const p = join(dir, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}