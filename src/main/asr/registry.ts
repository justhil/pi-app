import type { AsrConfig, AsrProvider } from '@shared/asr-types'
import { CodexAsrCliProvider } from './codex-asr-cli'
import { CodexAsrServeProvider } from './codex-asr-serve'
import { CodexDirectAsrProvider } from '../codex-transcribe/codex-direct-provider'

export function getAsrProvider(cfg: AsrConfig): AsrProvider | null {
  switch (cfg.provider) {
    case 'codex-asr-builtin':
      return new CodexDirectAsrProvider(cfg)
    case 'codex-asr-cli': {
      const bin = (cfg.cliBinaryPath || 'codex-asr').trim()
      if (!bin) return null
      return new CodexAsrCliProvider(bin, cfg.language || 'auto', cfg.timeoutMs || 120000)
    }
    case 'codex-asr-serve':
      if (!cfg.serverUrl) return null
      return new CodexAsrServeProvider(cfg.serverUrl, cfg.apiKey, cfg.language || 'auto', cfg.timeoutMs || 120000)
    default:
      return null
  }
}
