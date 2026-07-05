import type { AsrConfig } from '@shared/asr-types'
import { configStore } from './config-store'
import { getCodexAccessToken, setCodexAccessToken } from './secret-store'

function stripTokenFromConfig(cfg: AsrConfig): AsrConfig {
  const {
    codexAccessToken: _t,
    codexAccessTokenSet: _s,
    codexAccessTokenPreview: _p,
    codexAccessTokenPreserved: _k,
    ...rest
  } = cfg
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
  if (token && token.length >= 20) {
    setCodexAccessToken(token)
  } else if (!cfg.codexAccessTokenPreserved) {
    setCodexAccessToken(null)
  }
  configStore.set('asrConfig', stripTokenFromConfig(cfg))
}

function maskTokenPreview(token: string): string {
  if (token.length <= 12) return '••••'
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

/** IPC/探测：UI 草稿无明文时，用 safeStorage 中已保存的 token。 */
export function mergeStoredCodexAccessToken(cfg: AsrConfig): AsrConfig {
  const inline = cfg.codexAccessToken?.trim()
  if (inline && inline.length >= 20) return cfg
  if (cfg.codexAccessTokenPreserved || cfg.codexAccessTokenSet) {
    const stored = getCodexAccessToken()
    if (stored) return { ...cfg, codexAccessToken: stored }
  }
  const stored = getCodexAccessToken()
  if (stored) return { ...cfg, codexAccessToken: stored }
  return cfg
}

export function asrConfigForSettingsResponse(cfg: AsrConfig): AsrConfig {
  const token = getCodexAccessToken()
  const base = stripTokenFromConfig(cfg)
  if (!token) {
    return { ...base, codexAccessTokenSet: false, codexAccessTokenPreserved: false }
  }
  return {
    ...base,
    codexAccessTokenSet: true,
    codexAccessTokenPreview: maskTokenPreview(token),
    codexAccessTokenPreserved: true,
  }
}