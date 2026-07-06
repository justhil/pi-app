// SDK Manager - current.json 读写、registry 查询、独立环境安装编排、npm 可用性检测

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { app } from 'electron'
import { errorMessage } from '@shared/error-message'
import { emitOperationEvent } from './operation-events'
import {
  resolveActiveSdk,
  resolveGlobalSdkPath,
  resolveUserSdkPath,
  readGlobalSdkVersion,
  readUserSdkVersion,
  readBuiltinSdkVersion,
  type SdkKind,
} from './sdk-loader'

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
  registryCache = null
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

function writeActive(target: SdkKind): void {
  const dir = sdkDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(currentJsonPath(), JSON.stringify({ active: target }, null, 2), 'utf-8')
}

/** 独立环境 stage 目录：userData/sdk/current/ */
function userStageDir(): string {
  return join(sdkDir(), 'current')
}

/**
 * 安装指定版本到独立环境（userData/sdk/current/，覆盖式）。
 * 写最小 staging package.json → npm install → 退出 0 才写 current.json {active:"user"}。
 */
export function installVersion(version: string, onProgress: (line: string) => void): Promise<void> {
  if (installing) return Promise.reject(new Error('正在安装，请等待当前升级完成'))
  installing = true
  return new Promise<void>((resolve, reject) => {
    const stage = userStageDir()
    try {
      // 清掉旧独立环境，保证覆盖式安装（版本切换不留残留）
      if (existsSync(stage)) rmSync(stage, { recursive: true, force: true })
      mkdirSync(stage, { recursive: true })
      writeFileSync(
        join(stage, 'package.json'),
        JSON.stringify({ name: 'pi-desktop-sdk-stage', private: true, version: '1.0.0' }, null, 2),
        'utf-8',
      )
    } catch (e: unknown) {
      installing = false
      reject(new Error(`准备安装目录失败: ${errorMessage(e)}`))
      return
    }

    const child = spawn(
      'npm',
      ['install', `${PKG}@${version}`, '--no-audit', '--no-fund', '--omit=dev'],
      { cwd: stage, shell: false, env: { ...process.env } },
    )
    const onLine = (buf: Buffer) => {
      for (const line of buf.toString().split('\n')) {
        const t = line.replace(/\r$/, '').trim()
        if (t) onProgress(t)
      }
    }
    child.stdout?.on('data', onLine)
    child.stderr?.on('data', onLine)
    child.on('error', (err) => {
      installing = false
      reject(new Error(`npm 启动失败: ${err.message}`))
    })
    child.on('close', (code) => {
      installing = false
      if (code === 0) {
        // 校验安装结果可解析再写 current
        if (!resolveUserSdkPath(app.getPath('userData'))) {
          reject(new Error('npm 退出 0 但独立环境入口缺失，未切换'))
          return
        }
        try {
          writeActive('user')
          invalidateSdkManagerCaches()
          resolve()
        } catch (e: unknown) {
          reject(new Error(`安装成功但写入配置失败: ${errorMessage(e)}`))
        }
      } else {
        reject(new Error(`npm 退出码 ${code}`))
      }
    })
  })
}

/** 切换生效环境。global/user 需先校验对应 pi 可解析；builtin 直接写。 */
export function switchTo(target: SdkKind): Promise<void> {
  const done = () => {
    invalidateSdkManagerCaches()
  }
  if (target === 'builtin') {
    writeActive('builtin')
    done()
    return Promise.resolve()
  }
  if (target === 'global') {
    if (!resolveGlobalSdkPath()) return Promise.reject(new Error('全局 pi 不可用，无法切换到全局版本'))
    writeActive('global')
    done()
    return Promise.resolve()
  }
  // user
  if (!resolveUserSdkPath(app.getPath('userData'))) {
    return Promise.reject(new Error('独立环境未安装，无法切换；请先升级安装'))
  }
  writeActive('user')
  done()
  return Promise.resolve()
}

export function isInstalling(): boolean {
  return installing
}
