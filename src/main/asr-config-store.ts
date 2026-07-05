import type { AsrConfig } from '@shared/asr-types'
import { configStore } from './config-store'
import { getCodexAccessToken, setCodexAccessToken } from './secret-store'

function stripTokenFromConfig(cfg: AsrConfig): AsrConfig {
  const { codexAccessToken: _t, ...rest } = cfg
  return rest as AsrConfig
}

/** 从磁盘读取并注入密钥；若发现历史明文则迁移后写回。 */
export function loadAsrConfig(): AsrConfig {
  const raw = configStore.get('asrConfig')
  let cfg: AsrConfig = { ...raw }
  const legacy = cfg.codexAccessToken?.trim()
  if (legacy && legacy.length >= 20) {
    setCodexAccessToken(legacy)
    cfg = stripTokenFromConfig(cfg)
    configStore.set('asrConfig', cfg)
  }
  const fromSecret = getCodexAccessToken()
  if (fromSecret) return { ...cfg, codexAccessToken: fromSecret }
  return cfg
}

/** 持久化 ASR 配置；token 仅进 safeStorage，不进 electron-store JSON。 */
export function saveAsrConfig(cfg: AsrConfig): void {
  const token = cfg.codexAccessToken?.trim()
  setCodexAccessToken(token && token.length >= 20 ? token : null)
  configStore.set('asrConfig', stripTokenFromConfig(cfg))
}

function maskTokenPreview(token: string): string {
  if (token.length <= 12) return '••••'
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

export function asrConfigForSettingsResponse(cfg: AsrConfig): AsrConfig & {
  codexAccessTokenSet?: boolean
  codexAccessTokenPreview?: string
} {
  const token = getCodexAccessToken()
  const base = stripTokenFromConfig(cfg)
  if (!token) return { ...base, codexAccessTokenSet: false }
  return {
    ...base,
    codexAccessTokenSet: true,
    codexAccessTokenPreview: maskTokenPreview(token),
  }
}