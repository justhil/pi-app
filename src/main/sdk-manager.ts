// SDK Manager - current.json 读写、registry 查询、独立环境安装编排、npm 可用性检测

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn, spawnSync } from 'child_process'
import { app } from 'electron'
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

/** 检测系统 npm 是否可用（超时 3s 或非 0 视为不可用）。结果缓存。 */
export function checkNpmAvailable(): boolean {
  if (npmAvailableCache !== null) return npmAvailableCache
  try {
    const r = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: true, timeout: 3000 })
    npmAvailableCache = !r.error && r.status === 0 && !!(r.stdout || '').trim()
  } catch {
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

/** 查询 npm registry 全部已发布版本与 latest dist-tag。网络失败返回空，不抛错。 */
export async function listRegistryVersions(): Promise<{ versions: string[]; latest: string | null }> {
  try {
    const resp = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } })
    if (!resp.ok) return { versions: [], latest: null }
    const data: any = await resp.json()
    const versions = Object.keys(data.versions || {})
    const latest = data['dist-tags']?.latest || null
    return { versions, latest }
  } catch {
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
    } catch (e: any) {
      installing = false
      reject(new Error(`准备安装目录失败: ${e.message}`))
      return
    }

    const child = spawn(
      'npm',
      ['install', `${PKG}@${version}`, '--no-audit', '--no-fund', '--omit=dev'],
      { cwd: stage, shell: true, env: { ...process.env } },
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
          resolve()
        } catch (e: any) {
          reject(new Error(`安装成功但写入配置失败: ${e.message}`))
        }
      } else {
        reject(new Error(`npm 退出码 ${code}`))
      }
    })
  })
}

/** 切换生效环境。global/user 需先校验对应 pi 可解析；builtin 直接写。 */
export function switchTo(target: SdkKind): Promise<void> {
  if (target === 'builtin') {
    writeActive('builtin')
    return Promise.resolve()
  }
  if (target === 'global') {
    if (!resolveGlobalSdkPath()) return Promise.reject(new Error('全局 pi 不可用，无法切换到全局版本'))
    writeActive('global')
    return Promise.resolve()
  }
  // user
  if (!resolveUserSdkPath(app.getPath('userData'))) {
    return Promise.reject(new Error('独立环境未安装，无法切换；请先升级安装'))
  }
  writeActive('user')
  return Promise.resolve()
}

export function isInstalling(): boolean {
  return installing
}
