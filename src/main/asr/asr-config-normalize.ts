import type { AsrConfig } from '../../shared/asr-types'

/** 语音页「内置」与旧版 provider:none 在转写/测连时按内置处理 */
export function normalizeAsrConfigForOps(cfg: AsrConfig): AsrConfig {
  if (!cfg || cfg.provider === 'none' || cfg.provider === 'codex-asr-builtin') {
    return { ...cfg, provider: 'codex-asr-builtin' }
  }
  return cfg
}