import type { AsrProvider, AsrTranscribeRequest, AsrTranscribeResult } from '@shared/asr-types'
import type { AsrConfig } from '@shared/asr-types'
import { ensureBuiltinCodexAsrServe, getBuiltinServeBaseUrl } from './codex-asr-manager'
import { CodexAsrServeProvider } from './codex-asr-serve'

export class BuiltinCodexAsrProvider implements AsrProvider {
  id = 'codex-asr-builtin'

  constructor(private cfg: AsrConfig) {}

  private async delegate(): Promise<CodexAsrServeProvider | null> {
    const started = await ensureBuiltinCodexAsrServe(this.cfg)
    if (!started.ok) return null
    const url = started.baseUrl || getBuiltinServeBaseUrl()
    return new CodexAsrServeProvider(url, undefined, this.cfg.language || 'auto', this.cfg.timeoutMs || 120000)
  }

  async transcribe(req: AsrTranscribeRequest): Promise<AsrTranscribeResult> {
    const p = await this.delegate()
    if (!p) {
      const started = await ensureBuiltinCodexAsrServe(this.cfg)
      const msg = started.error || 'builtin serve unavailable'
      const kind = msg.includes('not found') || msg.includes('ENOENT') ? 'not_configured' : 'upstream'
      return { ok: false, error: msg, kind }
    }
    return p.transcribe(req)
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    const started = await ensureBuiltinCodexAsrServe(this.cfg)
    if (!started.ok) return { ok: false, detail: started.error }
    const p = new CodexAsrServeProvider(
      started.baseUrl || getBuiltinServeBaseUrl(),
      undefined,
      this.cfg.language || 'auto',
      5000,
    )
    return p.testConnection()
  }
}