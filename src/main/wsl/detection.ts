/**
 * Enumerating and probing WSL distros on the Windows host.
 *
 * All probes are async (spawn-based) — `wsl.exe` can take 8–15s to boot a
 * distro, and running them synchronously on the IPC thread would freeze
 * Electron Main (settings open / distro pick). Distro listing is cached for a
 * short TTL and per-distro probes are single-flighted: concurrent callers share
 * one in-flight probe instead of spawning `wsl.exe` again.
 */

import {
  isValidWslDistroName,
  runWslAsync,
  runWslDistroAsync,
  runWslDistroCdAsync,
  wslDefaultShellAsync,
  wslHomeDirAsync,
} from './wsl-exec.js'

export interface WslDistroInfo {
  name: string
  version?: number
  isDefault: boolean
}

export interface WslProbeResult {
  ok: boolean
  distro: string
  node: boolean
  nodeVersion?: string
  npm: boolean
  git: boolean
  pi: boolean
  supportsCd: boolean
  error?: string
}

function parseDistroJson(stdout: string): WslDistroInfo[] | null {
  try {
    const parsed = JSON.parse(stdout) as {
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
  return null
}

function parseQuietListing(stdout: string): WslDistroInfo[] {
  const names = stdout
    .split('\n')
    .map((line) => line.trim().replace(/^[\uFEFF\x00]+|[\uFEFF\x00]+$/g, ''))
    .filter((line) => line && !/^NAME$/i.test(line) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\uFEFF]/.test(line))
  return names.map((name) => ({ name, isDefault: false }))
}

const LIST_TTL_MS = 10_000
let listCache: { at: number; value: WslDistroInfo[] } | null = null
let listInFlight: Promise<WslDistroInfo[]> | null = null

/** Clear listing/probe caches (tests, runtime switches). In-flight probes settle on their own. */
export function invalidateWslDetectionCaches(): void {
  listCache = null
  listInFlight = null
  probeCache.clear()
  probeInFlight.clear()
}

export function listWslDistrosAsync(): Promise<WslDistroInfo[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) {
    return Promise.resolve(listCache.value)
  }
  if (listInFlight) return listInFlight
  const p = runListWslDistrosAsync()
    .then((distros) => {
      listCache = { at: Date.now(), value: distros }
      return distros
    })
    .finally(() => {
      listInFlight = null
    })
  listInFlight = p
  return p
}

async function runListWslDistrosAsync(): Promise<WslDistroInfo[]> {
  const json = await runWslAsync(['--list', '--format', 'json'], { timeout: 15000 })
  if (json.status === 0 && json.stdout.trim()) {
    const parsed = parseDistroJson(json.stdout)
    if (parsed) return parsed
  }
  const quiet = await runWslAsync(['--list', '--quiet'], { timeout: 15000 })
  return parseQuietListing(quiet.stdout)
}

const PROBE_TTL_MS = 15_000
const probeCache = new Map<string, { at: number; result: WslProbeResult }>()
const probeInFlight = new Map<string, Promise<WslProbeResult>>()

/**
 * Probe a distro. Results are cached for a short TTL and concurrent probes for
 * the same distro share a single in-flight run (`force` bypasses the cache,
 * used by the manual "probe" button in Settings).
 */
export function probeWslDistroAsync(
  distro: string,
  opts: { force?: boolean } = {},
): Promise<WslProbeResult> {
  const cached = probeCache.get(distro)
  if (!opts.force && cached && Date.now() - cached.at < PROBE_TTL_MS) {
    return Promise.resolve(cached.result)
  }
  const inFlight = probeInFlight.get(distro)
  if (inFlight) return inFlight
  const p = runProbeWslDistroAsync(distro)
    .then((result) => {
      probeCache.set(distro, { at: Date.now(), result })
      return result
    })
    .finally(() => {
      probeInFlight.delete(distro)
    })
  probeInFlight.set(distro, p)
  return p
}

async function runProbeWslDistroAsync(distro: string): Promise<WslProbeResult> {
  const result: WslProbeResult = {
    ok: false,
    distro,
    node: false,
    npm: false,
    git: false,
    pi: false,
    supportsCd: true,
  }

  if (!isValidWslDistroName(distro)) {
    result.error = 'invalid wsl distro'
    return result
  }

  const home = await wslHomeDirAsync(distro)
  if (!home) {
    result.error = 'WSL 发行版不可用或尚未初始化'
    return result
  }

  const [cdRes, shell] = await Promise.all([
    runWslDistroCdAsync(distro, '/', ['true'], { timeout: 8000 }),
    wslDefaultShellAsync(distro),
  ])
  result.supportsCd = cdRes.status === 0

  const [node, deps] = await Promise.all([
    runWslDistroAsync(distro, [shell, '-lc', 'command -v node && node --version'], { timeout: 15000 }),
    runWslDistroAsync(distro, [shell, '-lc', 'command -v npm; command -v git; command -v pi'], {
      timeout: 15000,
    }),
  ])
  if (node.status === 0) {
    result.node = true
    const version = node.stdout.trim().split('\n').pop()?.trim()
    if (version) result.nodeVersion = version.replace(/^v/, '')
  }

  const lines = deps.stdout.trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const bin = line.split('/').pop()?.trim()
    if (bin === 'npm') result.npm = true
    else if (bin === 'git') result.git = true
    else if (bin === 'pi') result.pi = true
  }

  result.ok = result.node && result.npm
  if (!result.ok) {
    result.error = result.node ? '检测到 Node，但未找到 npm' : 'WSL 内未检测到 Node.js'
  }
  return result
}

/**
 * 上游命名兼容别名：host 侧 settings/wsl handlers 仍以 `listWslDistros` /
 * `probeWslDistro` 引用，内部即带 TTL 缓存与单飞行的异步实现。
 */
export const listWslDistros = listWslDistrosAsync
export const probeWslDistro = probeWslDistroAsync
