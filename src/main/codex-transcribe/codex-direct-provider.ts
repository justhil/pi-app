import type { AsrConfig, AsrProvider, AsrTranscribeRequest, AsrTranscribeResult } from '@shared/asr-types'
import { resolveAccessTokenForTranscribe } from '../asr/codex-auth'
import { pingChatGptSession, transcribeViaChatGptBackend } from './chatgpt-transcribe-client'

/** 内置：直连 https://chatgpt.com/backend-api/transcribe，无需 codex-asr 进程 */
export class CodexDirectAsrProvider implements AsrProvider {
  id = 'codex-asr-builtin'

  constructor(private cfg: AsrConfig) {}

  private auth() {
    const accessToken = resolveAccessTokenForTranscribe(this.cfg)
    if (!accessToken) return null
    return { accessToken }
  }

  async transcribe(req: AsrTranscribeRequest): Promise<AsrTranscribeResult> {
    const a = this.auth()
    if (!a) {
      return { ok: false, error: 'Codex access_token not configured', kind: 'not_configured' }
    }
    const language =
      this.cfg.language && this.cfg.language !== 'auto' ? this.cfg.language : req.language
    return transcribeViaChatGptBackend(a, { ...req, language }, this.cfg.timeoutMs || 120000)
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    const a = this.auth()
    if (!a) return { ok: false, detail: 'no access_token (paste token or sign in to Codex)' }
    return pingChatGptSession(a)
  }
}