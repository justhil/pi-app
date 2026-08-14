// SDK Loader - 解析当前生效 pi SDK 入口（内置 / 全局 / 独立环境）

import { existsSync, readFileSync, statSync } from 'fs'
import { basename, join } from 'path'
import {
  discoverGlobalPiCodingAgentRoot,
  resolvePackageEntryPath,
  validatePiCodingAgentRoot,
} from './global-sdk-resolve'

const PKG = '@earendil-works/pi-coding-agent'

export type SdkKind = 'builtin' | 'global' | 'user'

export interface ActiveSdk {
  kind: SdkKind
  version: string
  entryPath: string
  fallbackReason?: string
}

let globalSdkPathCache: { value: string | null; at: number } | null | undefined

// Resolving the active SDK is expensive for 'global' (synchronous npm spawns,
// up to a few seconds on Windows). Cache the full result keyed by the SDK config
// file's mtime so session.getMessages etc. never re-run the discovery per call.
// 失败结果（null / fallback）只短暂缓存：用户可能在进程运行中修复或新装全局 SDK，
// 永久负缓存会让设置页重读永远命中 null。
const FAILED_RESOLVE_TTL_MS = 30 * 1000

let activeSdkCache: { key: string; value: ActiveSdk; at: number } | null = null

export function clearGlobalSdkPathCache(): void {
  globalSdkPathCache = undefined
  activeSdkCache = null
}

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

function resolveEntryPath(pkgRoot: string): string | null {
  return resolvePackageEntryPath(pkgRoot)
}

function validateEntry(pkgRoot: string): boolean {
  return validatePiCodingAgentRoot(pkgRoot)
}

export function resolveGlobalSdkPath(opts?: { skipSpawn?: boolean }): string | null {
  const cached = globalSdkPathCache
  if (cached != null) {
    const isFresh = cached.value !== null || Date.now() - cached.at < FAILED_RESOLVE_TTL_MS
    if (isFresh) return cached.value
  }
  // 命中失败结果且 TTL 已过：重新探测（成功结果永久缓存，直到 clear）
  const value = discoverGlobalPiCodingAgentRoot(opts)
  globalSdkPathCache = { value, at: Date.now() }
  return value
}

export function readGlobalSdkVersion(): string | null {
  return readVersionAt(resolveGlobalSdkPath())
}

export function resolveUserSdkPath(userDataDir: string, userDir?: string): string | null {
  const activeUserDir = userDir || readCurrentJson(userDataDir).userDir
  const pkgRoot = join(
    userDataDir,
    'sdk',
    activeUserDir || 'current',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
  )
  return validateEntry(pkgRoot) ? pkgRoot : null
}

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
  userDir?: string
}

export type SdkSelection =
  | { kind: 'builtin' | 'global' }
  | { kind: 'user'; userDir?: string }

function readCurrentJson(userDataDir: string): CurrentJson {
  try {
    const p = join(userDataDir, 'sdk', 'current.json')
    if (!existsSync(p)) return { active: 'builtin' }
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    if (data?.active === 'global') return { active: 'global' }
    if (data?.active === 'user') {
      const userDir = data.userDir
      if (userDir === undefined) return { active: 'user' }
      if (
        typeof userDir !== 'string' ||
        userDir === '.' ||
        userDir === '..' ||
        basename(userDir) !== userDir
      ) {
        return { active: 'builtin' }
      }
      return { active: 'user', userDir }
    }
    return { active: 'builtin' }
  } catch (e) {
    return { active: 'builtin' }
  }
}

export function readSdkSelection(userDataDir: string): SdkSelection {
  const current = readCurrentJson(userDataDir)
  return current.active === 'user'
    ? { kind: 'user', ...(current.userDir ? { userDir: current.userDir } : {}) }
    : { kind: current.active }
}

export function resolveUserSdkInstallDir(userDataDir: string): string | undefined {
  return readCurrentJson(userDataDir).userDir
}

function sdkConfigStamp(userDataDir: string): string {
  try {
    const p = join(userDataDir, 'sdk', 'current.json')
    return `${userDataDir}|${statSync(p).mtimeMs}`
  } catch {
    return `${userDataDir}|missing`
  }
}

export function resolveActiveSdk(userDataDir: string, opts?: { skipSpawn?: boolean }): ActiveSdk {
  const key = sdkConfigStamp(userDataDir)
  const cached = activeSdkCache
  if (cached && cached.key === key) {
    // 失败结果（fallbackReason）只缓存 FAILED_RESOLVE_TTL_MS：
    // 用户新装/修复 SDK 后，设置页强制刷新不应永远命中旧的 builtin 回退。
    const isFailure = cached.value.fallbackReason !== undefined
    if (!isFailure || Date.now() - cached.at < FAILED_RESOLVE_TTL_MS) return cached.value
  }
  const value = computeActiveSdk(userDataDir, opts)
  activeSdkCache = { key, value, at: Date.now() }
  return value
}

function computeActiveSdk(userDataDir: string, opts?: { skipSpawn?: boolean }): ActiveSdk {
  const { active } = readCurrentJson(userDataDir)
  if (active === 'global') {
    const globalRoot = resolveGlobalSdkPath(opts)
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
