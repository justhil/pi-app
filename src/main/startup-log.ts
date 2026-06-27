import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { configStore } from './config-store'

export type StartupLogLevel = 'info' | 'warn' | 'error'

export type StartupLogEntry = {
  t: string
  level: StartupLogLevel
  phase: string
  message: string
  detail?: Record<string, unknown>
}

const LOG_NAME = 'startup.log'
const MAX_LINES = 400

let runId: string | null = null
let buffer: StartupLogEntry[] = []
let filePath: string | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function diagnosticsEnabled(): boolean {
  if (process.env.PI_STARTUP_LOG === '1' || process.env.PI_STARTUP_LOG === 'true') return true
  return configStore.get('startupDiagnosticsEnabled') !== false
}

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

function resolveFilePath(): string {
  if (!filePath) filePath = join(logDir(), LOG_NAME)
  return filePath
}

function scheduleFlush(): void {
  if (!diagnosticsEnabled()) return
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushStartupLog()
  }, 80)
}

/** 每次应用进程启动调用一次：清空 startup.log，开始新 run。默认不写盘，仅内存缓冲。 */
export function beginStartupRun(): string {
  runId = `${Date.now()}-${process.pid}`
  buffer = []
  filePath = null
  pushStartupLog('info', 'main', 'startup.run.begin', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    dev: !app.isPackaged,
    runId,
    diagnosticsFile: diagnosticsEnabled(),
  })
  if (diagnosticsEnabled()) {
    try {
      mkdirSync(logDir(), { recursive: true })
      writeFileSync(resolveFilePath(), formatRunHeader() + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }
  return runId
}

function formatRunHeader(): string {
  const first = buffer[0]
  return first ? JSON.stringify(first) : JSON.stringify({ t: new Date().toISOString(), phase: 'main', message: 'startup.run.begin' })
}

export function pushStartupLog(
  level: StartupLogLevel,
  phase: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  const entry: StartupLogEntry = {
    t: new Date().toISOString(),
    level,
    phase,
    message,
    ...(detail && Object.keys(detail).length > 0 ? { detail } : {}),
  }
  buffer.push(entry)
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES)
  if (!diagnosticsEnabled()) return
  scheduleFlush()
}

export function flushStartupLog(): void {
  if (!diagnosticsEnabled() || buffer.length === 0) return
  try {
    mkdirSync(logDir(), { recursive: true })
    const lines = buffer.map((e) => JSON.stringify(e)).join('\n') + '\n'
    writeFileSync(resolveFilePath(), lines, 'utf8')
  } catch {
    /* ignore */
  }
}

export function getStartupLogPath(): string {
  return join(app.getPath('userData'), 'logs', LOG_NAME)
}

export function readStartupLogTail(maxLines = 120): { path: string; lines: string[]; enabled: boolean } {
  const enabled = diagnosticsEnabled()
  const path = getStartupLogPath()
  if (!enabled || !existsSync(path)) {
    const mem = buffer.map((e) => JSON.stringify(e))
    return { path, lines: mem.slice(-maxLines), enabled }
  }
  try {
    const raw = readFileSync(path, 'utf8')
    const lines = raw.split('\n').filter((l) => l.trim())
    return { path, lines: lines.slice(-maxLines), enabled }
  } catch {
    return { path, lines: [], enabled }
  }
}

export function isStartupDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled()
}