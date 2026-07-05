import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let logPath: string | null = null

function enabled(): boolean {
  return process.env.PI_AUDIO_TRACE === '1' || process.env.PI_AUDIO_TRACE === 'true'
}

function ensureLogPath(): string {
  if (logPath) return logPath
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logPath = join(dir, 'audio-trace.log')
  return logPath
}

export function traceAudio(source: string, detail: Record<string, unknown> = {}): void {
  if (!enabled()) return
  const line = JSON.stringify({ t: new Date().toISOString(), source, ...detail }) + '\n'
  try {
    appendFileSync(ensureLogPath(), line, 'utf8')
  } catch (e) {
    /* ignore */
  }
  console.log(`[audio-trace] ${source}`, detail)
}

export function getAudioTraceLogHint(): string {
  return join(app.getPath('userData'), 'logs', 'audio-trace.log')
}