/**
 * Enumerating and probing WSL distros on the Windows host.
 */

import { runWslDistroCdSync, runWslDistroSync, runWslSync, wslDefaultShellSync, wslHomeDirSync } from './wsl-exec.js'

export interface WslDistroInfo {
  name: string
  version?: number
  isDefault: boolean
}

export function listWslDistros(): WslDistroInfo[] {
  const json = runWslSync(['--list', '--format', 'json'], { timeout: 15000 })
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

  const quiet = runWslSync(['--list', '--quiet'], { timeout: 15000 })
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
  npm: boolean
  git: boolean
  pi: boolean
  supportsCd: boolean
  error?: string
}

export function probeWslDistro(distro: string): WslProbeResult {
  const result: WslProbeResult = {
    ok: false,
    distro,
    node: false,
    npm: false,
    git: false,
    pi: false,
    supportsCd: true,
  }

  const home = wslHomeDirSync(distro)
  if (!home) {
    result.error = 'WSL 发行版不可用或尚未初始化'
    return result
  }

  result.supportsCd = runWslDistroCdSync(distro, '/', ['true']).status === 0

  const shell = wslDefaultShellSync(distro)

  const node = runWslDistroSync(distro, [shell, '-lc', 'command -v node && node --version'])
  if (node.status === 0) {
    result.node = true
    const version = node.stdout.trim().split('\n').pop()?.trim()
    if (version) result.nodeVersion = version.replace(/^v/, '')
  }

  const deps = runWslDistroSync(
    distro,
    [shell, '-lc', 'command -v npm; command -v git; command -v pi'],
  )
  const lines = deps.stdout.trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const bin = line.split('/').pop()?.trim()
    if (bin === 'npm') result.npm = true
    else if (bin === 'git') result.git = true
    else if (bin === 'pi') result.pi = true
  }

  result.ok = result.node && result.npm
  if (!result.ok) {
    result.error = result.node
      ? '检测到 Node，但未找到 npm'
      : 'WSL 内未检测到 Node.js'
  }
  return result
}
