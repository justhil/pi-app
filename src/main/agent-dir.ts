/**
 * Resolves the pi agent directory (`~/.pi/agent`) that the desktop UI reads
 * (prompts catalog, skills, resources, extension probe, agent settings).
 *
 * In WSL mode this must point at the distro's agent dir (viewed over UNC), not
 * the Windows host's, because the agent runtime inside WSL reads/writes its own
 * `$HOME/.pi/agent`.
 */

import { homedir } from 'os'
import { join } from 'path'
import { wslPathToWindows } from '@shared/wsl-path'
import { setActiveDirResolvers } from '../extension-compat/active-dirs'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { wslHomeDirSync } from './wsl/wsl-exec'

/** 与 SDK getAgentDir() 的 expandTildePath 语义一致：展开 ~ 前缀。 */
function expandTilde(p: string): string {
  const trimmed = p.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || (process.platform === 'win32' && trimmed.startsWith('~\\'))) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

export function resolveActiveAgentDir(): string {
  const { mode, distro } = getAgentRuntimeConfig()
  if (mode === 'wsl' && distro) {
    const home = wslHomeDirSync(distro)
    if (home) return wslPathToWindows(distro, `${home}/.pi/agent`)
  }
  // 宿主模式下尊重 SDK 支持的 PI_CODING_AGENT_DIR 覆盖（读模型/提示词时与 worker 一致）。
  const envDir = process.env.PI_CODING_AGENT_DIR
  if (envDir) return expandTilde(envDir)
  return join(homedir(), '.pi', 'agent')
}

export function resolveActiveDesktopDir(): string {
  const { mode, distro } = getAgentRuntimeConfig()
  if (mode === 'wsl' && distro) {
    const home = wslHomeDirSync(distro)
    if (home) return wslPathToWindows(distro, `${home}/.pi/desktop`)
  }
  return join(homedir(), '.pi', 'desktop')
}

export function resolveActiveHomeDir(): string {
  const { mode, distro } = getAgentRuntimeConfig()
  if (mode === 'wsl' && distro) {
    const home = wslHomeDirSync(distro)
    if (home) return wslPathToWindows(distro, home)
  }
  return homedir()
}

export function resolveActiveAgentSettingsFile(): string {
  return join(resolveActiveAgentDir(), 'settings.json')
}

setActiveDirResolvers({
  agentDir: () => resolveActiveAgentDir(),
  desktopDir: () => resolveActiveDesktopDir(),
  homeDir: () => resolveActiveHomeDir(),
})
