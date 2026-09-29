/**
 * Enumerating and probing WSL distros on the Windows host.
 */

import { isValidWslDistroName, runWslAsync } from './wsl-exec.js'
import { resolveWslEnv, type WslEnv } from './wsl-env.js'
import { resolveWslActiveSdk } from './sdk-resolve.js'

export interface WslDistroInfo {
  name: string
  version?: number
  isDefault: boolean
}

export async function listWslDistros(): Promise<WslDistroInfo[]> {
  const json = await runWslAsync(['--list', '--format', 'json'], { timeout: 15000 })
  if (json.status === 0 && json.stdout.trim()) {
    try {
      const parsed = JSON.parse(json.stdout) as {
        default?: string
        distributions?: Array<{
          name?: string
          version?: number
          default?: boolean
          flags?: string[]
        }>
      }
      const defaultName = parsed.default
      const distros = parsed.distributions
      if (Array.isArray(distros) && distros.length > 0) {
        return distros
          .map((d) => ({
            name: d.name ?? '',
            version: d.version,
            isDefault: Boolean(d.default) || d.name === defaultName,
          }))
          .filter((d) => d.name)
      }
    } catch {
      // fall through to the quiet listing below
    }
  }

  const quiet = await runWslAsync(['--list', '--quiet'], { timeout: 15000 })
  const names = quiet.stdout
    .split('\n')
    .map((line) => line.trim().replace(/^[\uFEFF\x00]+|[\uFEFF\x00]+$/g, ''))
    .filter((line) => line && !/^NAME$/i.test(line) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\uFEFF]/.test(line))
  return names.map((name) => ({ name, isDefault: false }))
}

export interface WslProbeResult {
  ok: boolean
  distro: string
  node: boolean
  nodeVersion?: string
  nodePath?: string
  npm: boolean
  git: boolean
  pi: boolean
  /** pi-coding-agent package the worker will import (what actually matters for running). */
  sdk: boolean
  sdkVersion?: string
  sdkPath?: string
  home?: string
  shell?: string
  /** How the login environment was captured (interactive-login ≈ the user's terminal). */
  envMode?: WslEnv['mode']
  /** PATH entries the agent gains from the login shell beyond wsl.exe's default PATH. */
  pathExtras: string[]
  supportsCd: boolean
  error?: string
}

const DEFAULT_WSL_PATH = new Set([
  '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
  '/usr/games', '/usr/local/games', '/usr/lib/wsl/lib',
])

/**
 * One captured login environment (see wsl-env.ts) plus the SDK lookup — instead of 4–5 separate
 * wsl.exe probes that each used a different shell/PATH than the worker does.
 * `refresh` re-captures; otherwise the cached environment answers instantly.
 */
export async function probeWslDistro(distro: string, opts?: { refresh?: boolean }): Promise<WslProbeResult> {
  const result: WslProbeResult = {
    ok: false,
    distro,
    node: false,
    npm: false,
    git: false,
    pi: false,
    sdk: false,
    pathExtras: [],
    supportsCd: true,
  }

  if (!isValidWslDistroName(distro)) {
    result.error = 'invalid wsl distro'
    return result
  }

  const env = await resolveWslEnv(distro, { force: opts?.refresh })
  if (!env) {
    result.error = 'WSL 发行版不可用或尚未初始化'
    return result
  }
  const sdk = await resolveWslActiveSdk(distro, { refresh: opts?.refresh }).catch(() => null)

  result.home = env.home
  result.shell = env.shell
  result.envMode = env.mode
  result.supportsCd = env.cdSupported
  result.node = !!env.node
  result.nodePath = env.node ?? undefined
  result.nodeVersion = env.nodeVersion ?? undefined
  result.npm = !!env.npm
  result.git = !!env.git
  result.pi = !!env.pi
  result.sdk = !!sdk
  result.sdkVersion = sdk?.version ?? undefined
  result.sdkPath = sdk?.packageRoot
  result.pathExtras = env.path
    .split(':')
    .filter((entry) => entry && !DEFAULT_WSL_PATH.has(entry) && !entry.startsWith('/mnt/'))

  result.ok = result.node && result.sdk
  if (!result.node) result.error = 'WSL 内未检测到 Node.js'
  else if (!result.sdk) result.error = '未检测到 pi-coding-agent'
  return result
}
