import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AsrConfig } from '../../shared/asr-types'
import { resolveAuthFileForServe } from './codex-auth'

const DEFAULT_PORT = 18788
const HEALTH_PATH = '/healthz'

let child: ChildProcess | null = null
let activePort = DEFAULT_PORT
let starting: Promise<void> | null = null

function bundledBinary(): string | null {
  const base = join(process.resourcesPath, 'codex-asr')
  const win = join(base, 'win-x64', 'codex-asr.exe')
  const mac = join(base, 'darwin-universal', 'codex-asr')
  const linux = join(base, 'linux-x64', 'codex-asr')
  if (process.platform === 'win32' && existsSync(win)) return win
  if (process.platform === 'darwin' && existsSync(mac)) return mac
  if (process.platform === 'linux' && existsSync(linux)) return linux
  return null
}

function resolveBinary(cfg: AsrConfig): string {
  const bundled = bundledBinary()
  if (bundled) return bundled
  const custom = (cfg.cliBinaryPath || 'codex-asr').trim()
  return custom || 'codex-asr'
}

export function getBuiltinServeBaseUrl(): string {
  return `http://127.0.0.1:${activePort}`
}

export function getCodexAsrManagerStatus(): {
  running: boolean
  port: number
  bundled: boolean
  binary: string | null
  pid: number | null
} {
  return {
    running: child != null && !child.killed,
    port: activePort,
    bundled: !!bundledBinary(),
    binary: child ? resolveBinary({ provider: 'codex-asr-builtin' } as AsrConfig) : null,
    pid: child?.pid ?? null,
  }
}

async function waitHealth(port: number, ms = 8000): Promise<boolean> {
  const url = `http://127.0.0.1:${port}${HEALTH_PATH}`
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

export async function ensureBuiltinCodexAsrServe(cfg: AsrConfig): Promise<{ ok: boolean; error?: string; baseUrl?: string }> {
  const auth = resolveAuthFileForServe(cfg)
  if (!auth.ok || !auth.authFile) {
    return { ok: false, error: auth.error || 'Codex not logged in' }
  }

  if (child && !child.killed) {
    const healthy = await waitHealth(activePort, 2000)
    if (healthy) return { ok: true, baseUrl: getBuiltinServeBaseUrl() }
    await stopBuiltinCodexAsrServe()
  }

  if (starting) {
    await starting
    if (child && !child.killed) return { ok: true, baseUrl: getBuiltinServeBaseUrl() }
  }

  const bin = resolveBinary(cfg)
  const port = cfg.builtinServePort ?? DEFAULT_PORT
  activePort = port

  starting = new Promise<void>((resolve, reject) => {
    const args = [
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--auth-file',
      auth.authFile,
      '--no-api-key',
    ]
    try {
      const proc = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
      })
      child = proc
      proc.on('error', (err) => {
        if (child === proc) child = null
        reject(err)
      })
      proc.on('exit', () => {
        if (child === proc) child = null
      })
      proc.stderr?.on('data', (d) => {
        const line = d.toString().trim()
        if (line) console.warn('[codex-asr serve]', line)
      })
      resolve()
    } catch (e) {
      reject(e)
    }
  })

  try {
    await starting
  } catch (e: any) {
    starting = null
    return { ok: false, error: e.code === 'ENOENT' ? `codex-asr not found (${bin})` : e.message }
  } finally {
    starting = null
  }

  const healthy = await waitHealth(port)
  if (!healthy) {
    await stopBuiltinCodexAsrServe()
    return { ok: false, error: 'codex-asr serve started but health check failed' }
  }
  return { ok: true, baseUrl: getBuiltinServeBaseUrl() }
}

export async function stopBuiltinCodexAsrServe(): Promise<void> {
  const proc = child
  child = null
  if (!proc || proc.killed) return
  try {
    proc.kill()
  } catch {
    /* */
  }
  await new Promise((r) => setTimeout(r, 100))
}

export function bundledCodexAsrAvailable(): boolean {
  return !!bundledBinary()
}