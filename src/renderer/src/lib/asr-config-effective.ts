import type { AsrConfig } from '@shared/asr-types'

/** 与 Main `normalizeAsrConfigForOps` 一致 */
export function normalizeAsrProvider(cfg: AsrConfig): AsrConfig {
  if (!cfg || cfg.provider === 'none' || cfg.provider === 'codex-asr-builtin') {
    return { ...cfg, provider: 'codex-asr-builtin' }
  }
  return cfg
}

export function isAsrVoiceReady(cfg: AsrConfig | null | undefined): boolean {
  if (!cfg) return false
  const c = normalizeAsrProvider(cfg)
  if (c.provider === 'codex-asr-builtin' || c.provider === 'codex-asr-cli') return true
  if (c.provider === 'codex-asr-serve') return !!String(c.serverUrl || '').trim()
  return false
}

let previewAsrConfig: AsrConfig | null = null

export function setAsrConfigPreview(cfg: AsrConfig | null): void {
  previewAsrConfig = cfg
}

export function getAsrConfigForComposer(disk: AsrConfig | null | undefined): AsrConfig | null {
  const raw = previewAsrConfig ?? disk
  if (!raw) return null
  return normalizeAsrProvider(raw)
}