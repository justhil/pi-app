import { spawn } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { AsrProvider, AsrTranscribeRequest, AsrTranscribeResult } from '@shared/asr-types'
import { errorMessage } from '@shared/error-message'

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
}

export class CodexAsrCliProvider implements AsrProvider {
  id = 'codex-asr-cli'

  constructor(
    private binaryPath: string,
    private language: 'auto' | 'zh' | 'en' = 'auto',
    private timeoutMs = 120000,
  ) {}

  async transcribe(req: AsrTranscribeRequest): Promise<AsrTranscribeResult> {
    const ext = MIME_TO_EXT[req.mimeType] || 'webm'
    const tmpFile = join(tmpdir(), `pi-asr-${randomUUID()}.${ext}`)
    const contentTypes: Record<string, string> = {
      'audio/webm': 'audio/webm',
      'audio/mp4': 'audio/mp4',
      'audio/wav': 'audio/wav',
    }
    const contentType = contentTypes[req.mimeType] || req.mimeType

    await writeFile(tmpFile, req.audio)

    try {
      const args = ['transcribe', tmpFile, '--json', '--content-type', contentType]
      if (this.language && this.language !== 'auto') {
        args.push('--language', this.language)
      }

      const result = await this.runProcess(this.binaryPath, args, this.timeoutMs)
      if (result.code !== 0) {
        const stderr = result.stderr.toLowerCase()
        if (stderr.includes('auth') || stderr.includes('unauthorized') || stderr.includes('login')) {
          return { ok: false, error: 'codex-asr auth failed: no valid login session', kind: 'auth' }
        }
        return { ok: false, error: result.stderr || 'transcribe failed', kind: 'upstream' }
      }

      const text = this.parseJson(result.stdout)
      if (text === null) {
        return { ok: false, error: 'failed to parse codex-asr output', kind: 'unknown' }
      }
      return { ok: true, text }
    } catch (e: unknown) {
      const err = e as { code?: string; killed?: boolean }
      if (err.code === 'ENOENT') {
        return { ok: false, error: `codex-asr binary not found: ${this.binaryPath}`, kind: 'not_configured' }
      }
      if (err.killed) {
        return { ok: false, error: 'transcription timed out', kind: 'timeout' }
      }
      return { ok: false, error: errorMessage(e) || 'unknown error', kind: 'unknown' }
    } finally {
      try { await unlink(tmpFile) } catch (e) { /* temp file cleanup best-effort */ }
    }
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const result = await this.runProcess(this.binaryPath, ['--version'], 5000)
      if (result.code === 0) {
        return { ok: true, detail: result.stdout.trim() }
      }
      return { ok: false, detail: result.stderr || 'unknown error' }
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'ENOENT') {
        return { ok: false, detail: `binary not found: ${this.binaryPath}` }
      }
      return { ok: false, detail: errorMessage(e) }
    }
  }

  private runProcess(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { timeout: timeoutMs })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr })
      })
    })
  }

  private parseJson(stdout: string): string | null {
    try {
      const parsed = JSON.parse(stdout.trim())
      if (parsed && typeof parsed.text === 'string') return parsed.text
    } catch (e) {
      // not JSON; maybe plain text
      const text = stdout.trim()
      return text || null
    }
    return null
  }
}
