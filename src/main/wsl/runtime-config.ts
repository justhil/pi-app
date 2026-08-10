/**
 * Reading the active agent runtime configuration (host vs WSL) that lives in
 * the persisted settings store.
 */

import { configStore } from '../config-store.js'

export interface AgentRuntimeConfig {
  mode: 'host' | 'wsl'
  distro: string | null
}

export function getAgentRuntimeConfig(): AgentRuntimeConfig {
  const cfg = configStore.get('agentRuntime')
  const mode = cfg?.mode === 'wsl' ? 'wsl' : 'host'
  const distro =
    mode === 'wsl' && typeof cfg?.distro === 'string' && cfg.distro.trim() !== ''
      ? cfg.distro.trim()
      : null
  return { mode, distro }
}

export function isWslRuntimeActive(): boolean {
  const { mode, distro } = getAgentRuntimeConfig()
  return mode === 'wsl' && distro !== null
}

export function setAgentRuntimeMode(mode: 'host' | 'wsl', distro: string | null): void {
  configStore.set('agentRuntime', { mode, distro })
}
