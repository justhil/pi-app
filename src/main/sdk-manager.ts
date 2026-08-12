// SDK Manager - current.json 读写、registry 查询、独立环境安装编排、npm 可用性检测

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { spawn, spawnSync } from 'child_process'
import { app } from 'electron'
import { errorMessage } from '@shared/error-message'
import { emitOperationEvent } from './operation-events'
import {
  resolveActiveSdk,
  resolveGlobalSdkPath,
  resolveUserSdkPath,
  resolveUserSdkInstallDir,
  readGlobalSdkVersion,
  readUserSdkVersion,
  readBuiltinSdkVersion,
  type SdkKind,
  type SdkSelection,
} from './sdk-loader'
import {
  resolveWslActiveSdk,
  assertWslSdkAvailable,
  invalidateWslSdkResolveCache,
} from './wsl/sdk-resolve'
import { invalidateWslEnvCaches } from './wsl/wsl-exec'

const PKG = '@earendil-works/pi-coding-agent'
const REGISTRY_URL = 'https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent'

export interface SdkStatus {
  builtinVersion: string
  globalVersion: string | null
  userVersion: string | null
  active: { kind: SdkKind; version: string; fallbackReason?: string }
  latest: string | null
  npmAvailable: boolean
  /** Worker init 时目标 SDK 加载失败已回退内置（运行时信号）。 */
  workerFallback?: boolean
}

let npmAvailableCache: boolean | null = null

const SDK_STATUS_TTL_MS = 60_000
let sdkStatusCache: { at: number; value: SdkStatus } | null = null

const REGISTRY_TTL_MS = 10 * 60_000
let registryCache: { at: number; value: { versions: string[]; latest: string | null } } | null = null

export function invalidateSdkManagerCaches(): void {
  sdkStatusCache = null
  wslSdkCache = null
  registryCache = null
  invalidateWslSdkResolveCache()
  invalidateWslEnvCaches()
}

/** 检测系统 npm 是否可用（超时 3s 或非 0 视为不可用）。结果缓存。 */
export function checkNpmAvailable(): boolean {
  if (npmAvailableCache !== null) return npmAvailableCache
  try {
    const r = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: true, timeout: 3000 })
    npmAvailableCache = !r.error && r.status === 0 && !!(r.stdout || '').trim()
  } catch (e) {
    npmAvailableCache = false
  }
  return npmAvailableCache
}

export function readSdkStatus(userDataDir: string): SdkStatus {
  const active = resolveActiveSdk(userDataDir)
  return {
    builtinVersion: readBuiltinSdkVersion(),
    globalVersion: readGlobalSdkVersion(),
    userVersion: readUserSdkVersion(userDataDir),
    active: { kind: active.kind, version: active.version, fallbackReason: active.fallbackReason },
    latest: null,
    npmAvailable: checkNpmAvailable(),
  }
}

/** 设置页等高频读取：默认 TTL 缓存，避免每次清全局 SDK 缓存并重复 spawn npm/where。 */
export function readSdkStatusCached(userDataDir: string, opts?: { refresh?: boolean }): SdkStatus {
  const now = Date.now()
  if (!opts?.refresh && sdkStatusCache && now - sdkStatusCache.at < SDK_STATUS_TTL_MS) {
    return sdkStatusCache.value
  }
  const value = readSdkStatus(userDataDir)
  sdkStatusCache = { at: now, value }
  return value
}

/**
 * WSL 模式下全局 SDK 探测：发行版内 `npm i -g` 的 pi-coding-agent 视为全局版本。
 * 探测是异步的（要跑 wsl.exe bash 探测脚本），返回发行版内 SDK 的版本与生效 kind。
 */
export async function readWslSdkStatus(
  distro: string,
  opts?: { refresh?: boolean },
): Promise<{
  globalVersion: string | null
  active: SdkStatus['active']
}> {
  const sdk = await resolveWslActiveSdk(distro, opts)
  if (!sdk) {
    const builtinVersion = readBuiltinSdkVersion()
    return { globalVersion: null, active: { kind: 'builtin', version: builtinVersion } }
  }
  return {
    globalVersion: sdk.version,
    active: { kind: 'global', version: sdk.version || readBuiltinSdkVersion() },
  }
}

let wslSdkCache: { at: number; distro: string; value: { globalVersion: string | null; active: SdkStatus['active'] } } | null = null

/**
 * WSL 模式生效环境探测（含 TTL 缓存，独立于宿主 sdkStatusCache）。
 * WSL 模式下 worker 实际用 resolveWslActiveSdk 决定 SDK，current.json 只在宿主模式生效。
 */
export async function readWslSdkStatusCached(
  distro: string,
  opts?: { refresh?: boolean },
): Promise<{ globalVersion: string | null; active: SdkStatus['active'] }> {
  const now = Date.now()
  if (!opts?.refresh && wslSdkCache && wslSdkCache.distro === distro && now - wslSdkCache.at < SDK_STATUS_TTL_MS) {
    return wslSdkCache.value
  }
  const value = await readWslSdkStatus(distro, opts)
  wslSdkCache = { at: now, distro, value }
  return value
}

/** 查询 npm registry 全部已发布版本与 latest dist-tag。网络失败返回空，不抛错。 */
export function isAllowedSdkVersion(version: string, registry: { versions: string[]; latest: string | null }): boolean {
  const v = version.trim()
  if (!v) return false
  if (registry.latest && v === registry.latest) return true
  return registry.versions.includes(v)
}

export async function listRegistryVersionsCached(opts?: { refresh?: boolean }): Promise<{
  versions: string[]
  latest: string | null
}> {
  const now = Date.now()
  if (!opts?.refresh && registryCache && now - registryCache.at < REGISTRY_TTL_MS) {
    return registryCache.value
  }
  const value = await listRegistryVersions()
  registryCache = { at: now, value }
  return value
}

export async function listRegistryVersions(): Promise<{ versions: string[]; latest: string | null }> {
  const started = Date.now()
  emitOperationEvent({ operation: 'sdk.listRegistryVersions', status: 'start' })
  try {
    const resp = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25_000) })
    if (!resp.ok) {
      emitOperationEvent({ operation: 'sdk.listRegistryVersions', status: 'error', durationMs: Date.now() - started, detail: `http_${resp.status}` })
      return { versions: [], latest: null }
    }
    const data = (await resp.json()) as { versions?: Record<string, unknown>; 'dist-tags'?: { latest?: string } }
    const versions = Object.keys(data.versions || {})
    const latest = data['dist-tags']?.latest || null
    emitOperationEvent({ operation: 'sdk.listRegistryVersions', status: 'ok', durationMs: Date.now() - started })
    return { versions, latest }
  } catch (e) {
    const detail = errorMessage(e)
    emitOperationEvent({
      operation: 'sdk.listRegistryVersions',
      status: detail.toLowerCase().includes('timeout') ? 'timeout' : 'error',
      durationMs: Date.now() - started,
      detail,
    })
    return { versions: [], latest: null }
  }
}

let installing = false

function sdkDir(): string {
  return join(app.getPath('userData'), 'sdk')
}

function currentJsonPath(): string {
  return join(sdkDir(), 'current.json')
}

function writeActive(selection: SdkSelection): void {
  const dir = sdkDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const currentPath = currentJsonPath()
  const tempPath = `${currentPath}.${randomUUID()}.tmp`
  writeFileSync(
    tempPath,
    JSON.stringify(
      {
        active: selection.kind,
        ...(selection.kind === 'user' && selection.userDir ? { userDir: selection.userDir } : {}),
      },
      null,
      2,
    ),
    'utf-8',
  )
  try {
    renameSync(tempPath, currentPath)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

function userInstallDir(name: string): string {
  return join(sdkDir(), name)
}

function removeOtherUserInstalls(activeDir: string): void {
  for (const name of readdirSync(sdkDir())) {
    if (name !== activeDir && (name === 'current' || name.startsWith('user-'))) {
      try {
        rmSync(userInstallDir(name), { recursive: true, force: true })
      } catch (error) {
        console.warn('[SDK] failed to clean old user SDK:', errorMessage(error))
      }
    }
  }
}

export interface InstalledSdkVersion {
  userDir: string
}

/**
 * 安装指定版本到独立的 generation 目录。
 * 写最小 package.json → npm install → 校验成功后原子更新 current.json 指针。
 */
export function installVersion(
  version: string,
  onProgress: (line: string) => void,
): Promise<InstalledSdkVersion> {
  if (installing) return Promise.reject(new Error('正在安装，请等待当前升级完成'))
  installing = true
  return new Promise<InstalledSdkVersion>((resolve, reject) => {
    const generation = `user-${Date.now()}-${randomUUID()}`
    const stage = userInstallDir(generation)
    const removeStage = () => {
      try {
        rmSync(stage, { recursive: true, force: true })
      } catch (error) {
        console.warn('[SDK] failed to clean incomplete user SDK:', errorMessage(error))
      }
    }
    try {
      mkdirSync(stage, { recursive: true })
      writeFileSync(
        join(stage, 'package.json'),
        JSON.stringify({ name: 'pi-desktop-sdk-stage', private: true, version: '1.0.0' }, null, 2),
        'utf-8',
      )
    } catch (e: unknown) {
      installing = false
      removeStage()
      reject(new Error(`准备安装目录失败: ${errorMessage(e)}`))
      return
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        'npm',
        ['install', `${PKG}@${version}`, '--no-audit', '--no-fund', '--omit=dev'],
        { cwd: stage, shell: false, env: { ...process.env } },
      )
    } catch (error) {
      installing = false
      removeStage()
      reject(new Error(`npm 启动失败: ${errorMessage(error)}`))
      return
    }
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      installing = false
      removeStage()
      reject(error)
    }
    const onLine = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) {
        const t = line.replace(/\r$/, '').trim()
        if (t) onProgress(t)
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    child.on('error', (err) => {
      fail(new Error(`npm 启动失败: ${err.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      if (code === 0) {
        // 校验安装结果可解析再写 current
        if (!resolveUserSdkPath(app.getPath('userData'), generation)) {
          fail(new Error('npm 退出 0 但独立环境入口缺失，未切换'))
          return
        }
        try {
          writeActive({ kind: 'user', userDir: generation })
          settled = true
          installing = false
          invalidateSdkManagerCaches()
          resolve({ userDir: generation })
        } catch (e: unknown) {
          fail(new Error(`安装成功但写入配置失败: ${errorMessage(e)}`))
        }
      } else {
        fail(new Error(`npm 退出码 ${code}`))
      }
    })
  })
}

export function finalizeVersionInstall(userDir: string, confirmed: boolean): void {
  if (confirmed) removeOtherUserInstalls(userDir)
  else rmSync(userInstallDir(userDir), { recursive: true, force: true })
  invalidateSdkManagerCaches()
}

/** 切换生效环境。global/user 需先校验对应 pi 可解析；builtin 直接写。 */
export async function switchTo(selection: SdkSelection): Promise<void> {
  const target = selection.kind
  const done = () => {
    invalidateSdkManagerCaches()
  }
  const requestedUserDir = selection.kind === 'user' ? selection.userDir : undefined
  const userRoot = target === 'user'
    ? resolveUserSdkPath(app.getPath('userData'), requestedUserDir)
    : null
  const userDir = target === 'user'
    ? requestedUserDir ?? resolveUserSdkInstallDir(app.getPath('userData'))
    : undefined
  const { getAgentRuntimeConfig } = await import('./wsl/runtime-config')
  const runtime = getAgentRuntimeConfig()
  const wslDistro = runtime.mode === 'wsl' && runtime.distro ? runtime.distro : null

  if (target === 'builtin') {
    if (wslDistro) {
      // WSL 模式下 worker 由 resolveWslActiveSdk 决定 SDK，current.json 只在宿主生效，
      // 写入 builtin 标记是无效的，直接拒绝以免 UI 状态与真实行为不一致。
      return Promise.reject(new Error('WSL 模式下仅支持发行版内全局 SDK，无法切换到内置环境'))
    }
    writeActive({ kind: 'builtin' })
    done()
    return
  }
  if (target === 'global') {
    if (wslDistro) {
      await assertWslSdkAvailable(wslDistro, { refresh: true })
    } else if (!resolveGlobalSdkPath()) {
      return Promise.reject(new Error('全局 pi 不可用，无法切换到全局版本'))
    }
    writeActive({ kind: 'global' })
    done()
    return
  }
  // user
  if (wslDistro) {
    return Promise.reject(new Error('WSL 模式下暂不支持独立环境，请直接在发行版内使用 npm 管理'))
  }
  if (!userRoot) {
    return Promise.reject(new Error('独立环境未安装，无法切换；请先升级安装'))
  }
  writeActive({ kind: 'user', userDir })
  done()
  return
}

export function isInstalling(): boolean {
  return installing
}
