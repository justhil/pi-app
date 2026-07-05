import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'

const PKG_SCOPE = '@earendil-works'
const PKG_NAME = 'pi-coding-agent'
const PKG = `${PKG_SCOPE}/${PKG_NAME}`

export function resolvePackageEntryPath(pkgRoot: string): string | null {
  try {
    const pkgJsonPath = join(pkgRoot, 'package.json')
    if (!existsSync(pkgJsonPath)) return null
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
      main?: string
      exports?: Record<string, unknown> | string
    }
    let entry: string | undefined
    const exp = pkg.exports
    if (typeof exp === 'string') entry = exp
    else if (exp && typeof exp === 'object') {
      const dot = exp['.']
      if (typeof dot === 'string') entry = dot
      else if (dot && typeof dot === 'object' && 'import' in dot) entry = String((dot as { import?: string }).import)
    }
    entry = entry || pkg.main
    if (!entry) return null
    const abs = join(pkgRoot, entry.replace(/^\.\//, ''))
    if (existsSync(abs)) return abs
    const alt = join(pkgRoot, entry)
    return existsSync(alt) ? alt : null
  } catch {
    return null
  }
}

export function validatePiCodingAgentRoot(pkgRoot: string): boolean {
  return resolvePackageEntryPath(pkgRoot) !== null
}

function readVersionAt(pkgRoot: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

function spawnLines(cmd: string, args: string[]): string[] {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, timeout: 15_000 })
    if (r.error || r.status !== 0) return []
    return (r.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function npmCliPairs(): { cmd: string; args: string[] }[] {
  if (process.platform === 'win32') {
    return [
      { cmd: 'npm.cmd', args: ['list', '-g', PKG, '--json', '--depth=0'] },
      { cmd: 'npm', args: ['list', '-g', PKG, '--json', '--depth=0'] },
      { cmd: 'npm.cmd', args: ['prefix', '-g'] },
      { cmd: 'npm', args: ['prefix', '-g'] },
      { cmd: 'npm.cmd', args: ['root', '-g'] },
      { cmd: 'npm', args: ['root', '-g'] },
    ]
  }
  return [
    { cmd: 'npm', args: ['list', '-g', PKG, '--json', '--depth=0'] },
    { cmd: 'npm', args: ['prefix', '-g'] },
    { cmd: 'npm', args: ['root', '-g'] },
  ]
}

function pkgRootFromNpmListJson(stdout: string): string | null {
  try {
    const data = JSON.parse(stdout) as {
      dependencies?: Record<string, { version?: string; path?: string }>
    }
    const dep = data.dependencies?.[PKG]
    if (dep && typeof dep === 'object' && 'path' in dep && typeof dep.path === 'string') {
      const root = dep.path.trim()
      return validatePiCodingAgentRoot(root) ? root : null
    }
  } catch {
    /* ignore */
  }
  return null
}

function piPackageRootFromPiShim(shimPath: string): string | null {
  const normalized = shimPath.replace(/\\/g, '/')
  const marker = '/node_modules/@earendil-works/pi-coding-agent/'
  const idx = normalized.toLowerCase().indexOf(marker)
  if (idx < 0) return null
  const root = shimPath.slice(0, idx + marker.length - 1)
  return validatePiCodingAgentRoot(root) ? root : null
}

function piPackageRootBesideShim(shimPath: string): string | null {
  const dir = dirname(shimPath)
  const candidates = [
    join(dir, 'node_modules', PKG_SCOPE, PKG_NAME),
    join(dir, '..', 'node_modules', PKG_SCOPE, PKG_NAME),
    join(dir, '..', '..', 'node_modules', PKG_SCOPE, PKG_NAME),
  ]
  for (const c of candidates) {
    const abs = join(c)
    if (validatePiCodingAgentRoot(abs)) return abs
  }
  return null
}

function resolveViaPiShim(): string | null {
  const whereCmd = process.platform === 'win32' ? 'where' : 'which'
  const lines = spawnLines(whereCmd, ['pi'])
  for (const line of lines) {
    const fromScript = piPackageRootFromPiShim(line)
    if (fromScript) return fromScript
    const beside = piPackageRootBesideShim(line)
    if (beside) return beside
  }
  return null
}

/** npm i -g 常见全局 node_modules 目录（与平台默认 prefix 一致）。 */
function npmGlobalModuleRootsFromEnv(): string[] {
  const roots: string[] = []
  const prefixEnv = process.env.npm_config_prefix?.trim() || process.env.NPM_CONFIG_PREFIX?.trim()
  if (prefixEnv) {
    roots.push(join(prefixEnv, 'node_modules'))
    if (process.platform !== 'win32') roots.push(join(prefixEnv, 'lib', 'node_modules'))
  }
  const appData = process.env.APPDATA?.trim()
  if (appData) roots.push(join(appData, 'npm', 'node_modules'))
  const home = homedir()
  if (home) {
    roots.push(join(home, 'AppData', 'Roaming', 'npm', 'node_modules'))
    if (process.platform !== 'win32') {
      roots.push(join(home, '.npm-global', 'lib', 'node_modules'))
      roots.push(join(home, '.nvm', 'versions', 'node'))
    }
  }
  if (process.platform !== 'win32') {
    roots.push('/usr/local/lib/node_modules')
    roots.push('/usr/lib/node_modules')
  }
  return roots
}

function collectNpmGlobalModuleRoots(): string[] {
  const roots: string[] = [...npmGlobalModuleRootsFromEnv()]
  for (const { cmd, args } of npmCliPairs()) {
    if (args[0] !== 'prefix' && args[0] !== 'root') continue
    const lines = spawnLines(cmd, args)
    const line = lines[lines.length - 1]
    if (!line) continue
    if (args[0] === 'prefix') {
      roots.push(join(line, 'node_modules'))
      if (process.platform !== 'win32') roots.push(join(line, 'lib', 'node_modules'))
    } else {
      roots.push(line)
    }
  }
  return [...new Set(roots.map((r) => join(r)))]
}

/** pi-node 等非 npm -g 布局（在 npm 全局扫描之后尝试）。 */
function piNodeStyleModuleRoots(): string[] {
  const roots: string[] = []
  const local = process.env.LOCALAPPDATA?.trim()
  if (local) {
    roots.push(join(local, 'pi-node', 'current', 'node_modules'))
    roots.push(join(local, 'pi-node', 'current'))
  }
  const home = homedir()
  if (home) roots.push(join(home, 'AppData', 'Local', 'pi-node', 'current', 'node_modules'))
  return [...new Set(roots)]
}

function scanModuleRoot(moduleRoot: string): string | null {
  const direct = join(moduleRoot, PKG_SCOPE, PKG_NAME)
  if (validatePiCodingAgentRoot(direct)) return direct
  return null
}

/**
 * 全局 pi-coding-agent 包根目录。
 * 优先 npm i -g（list JSON → prefix/root 目录扫描），再 pi-node / where pi。
 */
export function discoverGlobalPiCodingAgentRoot(): string | null {
  const seen = new Set<string>()
  const tryPkgRoot = (root: string | null | undefined): string | null => {
    if (!root) return null
    const norm = join(root)
    if (seen.has(norm)) return null
    seen.add(norm)
    return validatePiCodingAgentRoot(norm) ? norm : null
  }
  const tryModuleRoot = (moduleRoot: string): string | null => tryPkgRoot(scanModuleRoot(moduleRoot))

  // 1) npm i -g：npm list 给出的安装 path（最准）
  for (const { cmd, args } of npmCliPairs()) {
    if (args[0] !== 'list') continue
    const out = spawnLines(cmd, args).join('\n')
    const hit = tryPkgRoot(pkgRootFromNpmListJson(out))
    if (hit) return hit
  }

  // 2) npm i -g：prefix/node_modules、npm root -g、APPDATA/npm/node_modules 等
  for (const moduleRoot of collectNpmGlobalModuleRoots()) {
    const hit = tryModuleRoot(moduleRoot)
    if (hit) return hit
  }

  // 3) where pi / which pi（含 Roaming\\npm\\pi.cmd 旁的 node_modules）
  const shimHit = tryPkgRoot(resolveViaPiShim())
  if (shimHit) return shimHit

  // 4) pi-node 等独立安装布局
  for (const moduleRoot of piNodeStyleModuleRoots()) {
    const hit = tryModuleRoot(moduleRoot)
    if (hit) return hit
  }

  return null
}

export function readGlobalPiCodingAgentVersion(): string | null {
  const root = discoverGlobalPiCodingAgentRoot()
  return root ? readVersionAt(root) : null
}