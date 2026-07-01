import type { AsrProvider, AsrTranscribeRequest, AsrTranscribeResult } from '@shared/asr-types'

export class CodexAsrServeProvider implements AsrProvider {
  id = 'codex-asr-serve'

  constructor(
    private serverUrl: string,
    private apiKey?: string,
    private language: 'auto' | 'zh' | 'en' = 'auto',
    private timeoutMs = 120000,
  ) {}

  async transcribe(req: AsrTranscribeRequest): Promise<AsrTranscribeResult> {
    const ext = req.filename || 'audio.webm'
    const formData = new FormData()
    formData.append('file', new Blob([req.audio], { type: req.mimeType }), ext)
    formData.append('response_format', 'json')
    if (this.language && this.language !== 'auto') {
      formData.append('language', this.language)
    }

    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const url = `${this.serverUrl.replace(/\/$/, '')}/v1/audio/transcriptions`
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: 'auth failed: invalid API key or session', kind: 'auth' }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        if (body.includes('ASR API error')) {
          return { ok: false, error: `upstream error: ${res.status}`, kind: 'upstream' }
        }
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}`, kind: 'upstream' }
      }

      const data = (await res.json()) as { text?: string }
      const text = data?.text
      if (typeof text === 'string') return { ok: true, text }
      return { ok: false, error: 'unexpected response format', kind: 'unknown' }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { ok: false, error: 'transcription timed out', kind: 'timeout' }
      }
      if (e.cause?.code === 'ECONNREFUSED' || e.message?.includes('fetch failed')) {
        return { ok: false, error: `cannot connect to ${this.serverUrl}`, kind: 'network' }
      }
      return { ok: false, error: e.message || 'unknown error', kind: 'unknown' }
    }
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const url = `${this.serverUrl.replace(/\/$/, '')}/healthz`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) {
        return { ok: true, detail: 'connected' }
      }
      return { ok: false, detail: `HTTP ${res.status}` }
    } catch (e: any) {
      return { ok: false, detail: e.message }
    }
  }
}
