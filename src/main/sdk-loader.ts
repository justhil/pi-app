// SDK Loader - 解析当前生效 pi SDK 入口（内置 / 全局 / 独立环境）

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const PKG = '@earendil-works/pi-coding-agent'

export type SdkKind = 'builtin' | 'global' | 'user'

export interface ActiveSdk {
  kind: SdkKind
  version: string
  /** 供 import() 使用：builtin=包名, global/user=完整入口文件绝对路径 */
  entryPath: string
  /** 目标环境不可用时的回退原因（UI 提示用） */
  fallbackReason?: string
}

let globalSdkPathCache: string | null | undefined

/** 仅成功解析到包根目录时缓存；失败不缓存，避免 Windows 首启 PATH 未就绪后永久「未检测」。 */
export function clearGlobalSdkPathCache(): void {
  globalSdkPathCache = undefined
}

function windowsNpmGlobalModuleRoots(): string[] {
  const roots: string[] = []
  const appData = process.env.APPDATA?.trim()
  if (appData) roots.push(join(appData, 'npm', 'node_modules'))
  const localAppData = process.env.LOCALAPPDATA?.trim()
  if (localAppData) roots.push(join(localAppData, 'npm', 'node_modules'))
  const home = homedir()
  if (home) roots.push(join(home, 'AppData', 'Roaming', 'npm', 'node_modules'))
  return [...new Set(roots)]
}

function globalPiPackageRootFromModuleRoot(moduleRoot: string): string | null {
  const pkgRoot = join(moduleRoot, '@earendil-works', 'pi-coding-agent')
  return validateEntry(pkgRoot) ? pkgRoot : null
}

function resolveGlobalSdkPathViaNpmCli(): string | null {
  const cmds =
    process.platform === 'win32'
      ? [
          { cmd: 'npm.cmd', args: ['root', '-g'] as string[] },
          { cmd: 'npm', args: ['root', '-g'] as string[] },
        ]
      : [{ cmd: 'npm', args: ['root', '-g'] as string[] }]
  for (const { cmd, args } of cmds) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, timeout: 12_000 })
      if (r.error || r.status !== 0) continue
      const root = (r.stdout || '').trim().split(/\r?\n/).pop()?.trim()
      if (!root) continue
      const found = globalPiPackageRootFromModuleRoot(root)
      if (found) return found
    } catch {
      continue
    }
  }
  return null
}

/** 读内置 pi 的 version（从 app node_modules）。缺失返回空串。 */
export function readBuiltinSdkVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return pkg.version || ''
    }
  } catch (e) { void e }
  return ''
}

/** 读 package.json 的 main/exports 入口，返回完整入口文件绝对路径；无效返回 null。 */
function resolveEntryPath(pkgRoot: string): string | null {
  try {
    const pkgJsonPath = join(pkgRoot, 'package.json')
    if (!existsSync(pkgJsonPath)) return null
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const entry = pkg.main || pkg.exports?.['.']?.import || pkg.exports?.['.']
    if (!entry || !existsSync(join(pkgRoot, entry))) return null
    return join(pkgRoot, entry)
  } catch (e) {
    return null
  }
}

function validateEntry(pkgRoot: string): boolean {
  return resolveEntryPath(pkgRoot) !== null
}

/** 解析全局 node_modules 下 pi 包根目录绝对路径；不存在返回 null。仅成功时缓存。 */
export function resolveGlobalSdkPath(): string | null {
  if (globalSdkPathCache !== undefined) return globalSdkPathCache
  let result = resolveGlobalSdkPathViaNpmCli()
  if (!result && process.platform === 'win32') {
    for (const moduleRoot of windowsNpmGlobalModuleRoots()) {
      const found = globalPiPackageRootFromModuleRoot(moduleRoot)
      if (found) {
        result = found
        break
      }
    }
  }
  if (result) globalSdkPathCache = result
  return result
}

/** 读全局 pi version；不存在返回 null。 */
export function readGlobalSdkVersion(): string | null {
  return readVersionAt(resolveGlobalSdkPath())
}

/** 独立环境 pi 包根目录绝对路径：userData/sdk/current/node_modules/@earendil-works/pi-coding-agent。 */
export function resolveUserSdkPath(userDataDir: string): string | null {
  const pkgRoot = join(userDataDir, 'sdk', 'current', 'node_modules', '@earendil-works', 'pi-coding-agent')
  return validateEntry(pkgRoot) ? pkgRoot : null
}

/** 读独立环境 pi version；不存在返回 null。 */
export function readUserSdkVersion(userDataDir: string): string | null {
  return readVersionAt(resolveUserSdkPath(userDataDir))
}

function readVersionAt(pkgRoot: string | null): string | null {
  if (!pkgRoot) return null
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'))
    return pkg.version || null
  } catch (e) {
    return null
  }
}

interface CurrentJson {
  active: SdkKind
}

function readCurrentJson(userDataDir: string): CurrentJson {
  try {
    const p = join(userDataDir, 'sdk', 'current.json')
    if (!existsSync(p)) return { active: 'builtin' }
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    if (data?.active === 'global' || data?.active === 'user') return { active: data.active }
    return { active: 'builtin' }
  } catch (e) {
    return { active: 'builtin' }
  }
}

/**
 * 解析当前生效 SDK：
 * active=global 且全局可解析 → global（entryPath=完整入口文件路径）
 * active=user 且独立环境可解析 → user（entryPath=完整入口文件路径）
 * 否则回退 builtin（entryPath=包名，走 app node_modules）
 */
export function resolveActiveSdk(userDataDir: string): ActiveSdk {
  const { active } = readCurrentJson(userDataDir)
  if (active === 'global') {
    const globalRoot = resolveGlobalSdkPath()
    if (globalRoot) {
      const entry = resolveEntryPath(globalRoot)
      if (entry) return { kind: 'global', version: readGlobalSdkVersion() || '', entryPath: entry }
    }
    return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG, fallbackReason: 'global-unavailable' }
  }
  if (active === 'user') {
    const userRoot = resolveUserSdkPath(userDataDir)
    if (userRoot) {
      const entry = resolveEntryPath(userRoot)
      if (entry) return { kind: 'user', version: readUserSdkVersion(userDataDir) || '', entryPath: entry }
    }
    return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG, fallbackReason: 'user-unavailable' }
  }
  return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG }
}
