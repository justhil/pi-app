import type { AsrTranscribeRequest, AsrTranscribeResult } from '../../shared/asr-types'
import { buildChatGptTranscribeHeaders } from './chatgpt-desktop-headers'
import { chatGptAccountIdFromAccessToken } from './jwt-account-id'

const TRANSCRIBE_URL = 'https://chatgpt.com/backend-api/transcribe'

const MIME_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}

function filenameForMime(mime: string): string {
  const base = mime.split(';')[0].trim()
  const ext = MIME_EXT[base] || MIME_EXT[mime] || 'webm'
  return `audio.${ext}`
}

function clipBody(body: string, max = 300): string {
  return body.split(/\s+/).join(' ').slice(0, max)
}

export type ChatGptTranscribeAuth = {
  accessToken: string
  accountId?: string | null
}

function resolveAccountId(auth: ChatGptTranscribeAuth): string | null {
  return auth.accountId ?? chatGptAccountIdFromAccessToken(auth.accessToken)
}

/** 极短静音 WAV，用于探测鉴权（与正式转写相同 headers / endpoint） */
function minimalProbeWav(): Buffer {
  const sampleRate = 8000
  const numChannels = 1
  const bitsPerSample = 16
  const numSamples = 80
  const dataSize = numSamples * (bitsPerSample / 8)
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28)
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

async function postTranscribeMultipart(
  auth: ChatGptTranscribeAuth,
  audio: Buffer,
  mimeType: string,
  filename: string,
  language: string | undefined,
  timeoutMs: number,
): Promise<{ status: number; bodyText: string }> {
  const token = auth.accessToken.trim()
  const accountId = resolveAccountId(auth)
  const contentType = mimeType.split(';')[0].trim() || 'audio/webm'
  const headers = buildChatGptTranscribeHeaders(token, accountId)

  const form = new FormData()
  const blob = new Blob([audio], { type: contentType })
  form.append('file', blob, filename.replace(/"/g, ''))
  if (language && language !== 'auto') {
    form.append('language', language)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const bodyText = await res.text().catch(() => '')
    return { status: res.status, bodyText }
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') {
      return { status: 0, bodyText: 'timeout' }
    }
    throw e
  }
}

export async function transcribeViaChatGptBackend(
  auth: ChatGptTranscribeAuth,
  req: AsrTranscribeRequest,
  timeoutMs: number,
): Promise<AsrTranscribeResult> {
  const token = auth.accessToken.trim()
  if (!token) {
    return { ok: false, error: 'missing access_token', kind: 'not_configured' }
  }

  const filename = req.filename || filenameForMime(req.mimeType)
  const contentType = req.mimeType.split(';')[0].trim() || 'audio/webm'

  try {
    const { status, bodyText } = await postTranscribeMultipart(
      auth,
      req.audio,
      contentType,
      filename,
      req.language,
      timeoutMs,
    )

    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: `ChatGPT transcribe auth rejected (HTTP ${status}): ${clipBody(bodyText)}`,
        kind: 'auth',
      }
    }
    if (status === 0 && bodyText === 'timeout') {
      return { ok: false, error: 'transcription timed out', kind: 'timeout' }
    }
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: `transcribe HTTP ${status}: ${clipBody(bodyText)}`,
        kind: 'upstream',
      }
    }

    const text = parseTranscribeResponse(bodyText)
    if (text == null) {
      return { ok: false, error: 'unexpected transcribe response', kind: 'unknown' }
    }
    return { ok: true, text }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error', kind: 'network' }
  }
}

function parseTranscribeResponse(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  try {
    const j = JSON.parse(t) as Record<string, unknown>
    if (typeof j.text === 'string') return j.text
    if (typeof j.transcript === 'string') return j.transcript
    if (typeof j.result === 'string') return j.result
  } catch {
    /* plain text */
  }
  if (t.length > 0 && !t.startsWith('{')) return t
  return null
}

/** 真实请求上游（短静音 WAV），与 codex-asr 转写鉴权一致；不仅解析 JWT */
export async function pingChatGptSession(auth: ChatGptTranscribeAuth): Promise<{ ok: boolean; detail?: string }> {
  if (!auth.accessToken.trim()) return { ok: false, detail: 'no access_token' }
  const accountId = resolveAccountId(auth)
  const wav = minimalProbeWav()
  try {
    const { status, bodyText } = await postTranscribeMultipart(
      auth,
      wav,
      'audio/wav',
      'probe.wav',
      undefined,
      25_000,
    )
    if (status === 401 || status === 403) {
      return { ok: false, detail: `upstream auth rejected HTTP ${status}: ${clipBody(bodyText, 120)}` }
    }
    if (status === 0 && bodyText === 'timeout') {
      return { ok: false, detail: 'upstream probe timed out' }
    }
    if (status >= 200 && status < 300) {
      return {
        ok: true,
        detail: accountId ? `upstream OK · account ${accountId.slice(0, 8)}…` : 'upstream OK',
      }
    }
    return {
      ok: true,
      detail: `upstream HTTP ${status} (auth likely OK): ${clipBody(bodyText, 80)}`,
    }
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'upstream probe failed' }
  }
}