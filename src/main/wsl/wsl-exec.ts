/**
 * Thin wrapper around `wsl.exe` for enumerating distros, probing them, and
 * running commands inside a distro. Only used on Windows hosts.
 */

import { execFileSync, spawn } from 'child_process'
import { errorMessage } from '@shared/error-message'

export const WSL_EXE = 'wsl.exe'

export const WSL_DISTRO_PATTERN = /^[A-Za-z0-9._-]+$/

export function isValidWslDistroName(distro: string | null | undefined): boolean {
  return typeof distro === 'string' && distro.trim() !== '' && WSL_DISTRO_PATTERN.test(distro)
}

export interface WslExecResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Decode `wsl.exe` output. Older/current `wsl.exe` variants emit UTF-16LE with
 * a BOM on some Windows builds; most emit UTF-8 (sometimes with a UTF-8 BOM).
 * Decoding UTF-16 as UTF-8 would interleave null bytes between every character
 * (`D\x00e\x00b\x00i\x00a\x00n`), corrupting distro names and breaking probes.
 */
export function decodeWslOutput(buf: Buffer | string | undefined | null): string {
  if (buf == null) return ''
  if (typeof buf === 'string') return buf.replace(/^\uFEFF/, '')
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le', 2).replace(/^\uFEFF/, '')
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2)
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1]
      swapped[i - 1] = buf[i]
    }
    return swapped.toString('utf16le').replace(/^\uFEFF/, '')
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf-8', 3).replace(/^\uFEFF/, '')
  }
  const utf16 = sniffUtf16NoBom(buf)
  if (utf16 === 'le') return buf.toString('utf16le')
  if (utf16 === 'be') return swapUtf16Bytes(buf).toString('utf16le')
  return buf.toString('utf-8')
}

function swapUtf16Bytes(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length)
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1]
    out[i + 1] = buf[i]
  }
  return out
}

/**
 * Detect UTF-16 text without a BOM by checking whether most code units are an
 * ASCII byte paired with a `0x00`. `wsl.exe --list --quiet` emits exactly this
 * (UTF-16LE, no BOM) on recent Windows builds; decoding it as UTF-8 interleaves
 * a null byte between every character.
 */
function sniffUtf16NoBom(buf: Buffer): 'le' | 'be' | null {
  const n = Math.min(buf.length, 512) & ~1
  if (n < 8) return null
  let le = 0
  let be = 0
  const isAscii = (b: number): boolean =>
    b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)
  for (let i = 0; i < n; i += 2) {
    if (buf[i + 1] === 0x00 && isAscii(buf[i])) le++
    if (buf[i] === 0x00 && isAscii(buf[i + 1])) be++
  }
  const half = n / 2
  if (le >= half * 0.6 && le > be) return 'le'
  if (be >= half * 0.6 && be > le) return 'be'
  return null
}

export function runWslSync(
  args: string[],
  opts: { timeout?: number; input?: string } = {},
): WslExecResult {
  try {
    const stdout = execFileSync(WSL_EXE, args, {
      encoding: 'buffer',
      timeout: opts.timeout ?? 15000,
      maxBuffer: 16 * 1024 * 1024,
      input: opts.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return { status: 0, stdout: decodeWslOutput(stdout), stderr: '' }
  } catch (e: unknown) {
    const err = e as {
      status?: number
      stdout?: Buffer | { toString(): string }
      stderr?: Buffer | { toString(): string }
    }
    const rawOut = err.stdout as Buffer | undefined
    const rawErr = err.stderr as Buffer | undefined
    return {
      status: typeof err.status === 'number' ? err.status : -1,
      stdout: rawOut ? decodeWslOutput(rawOut) : '',
      stderr: rawErr ? decodeWslOutput(rawErr) : errorMessage(e) ?? '',
    }
  }
}

export function runWslDistroSync(
  distro: string,
  args: string[],
  opts: { timeout?: number } = {},
): WslExecResult {
  if (!isValidWslDistroName(distro)) {
    return { status: -1, stdout: '', stderr: `invalid wsl distro: ${String(distro)}` }
  }
  return runWslSync(['-d', distro, '--', ...args], opts)
}

/**
 * Run a command inside a distro with `wsl.exe --cd <wslCwd>`, entering a
 * specific working directory. `--cd` must appear *before* the `--` separator.
 */
export function runWslDistroCdSync(
  distro: string,
  wslCwd: string,
  args: string[],
  opts: { timeout?: number } = {},
): WslExecResult {
  if (!isValidWslDistroName(distro)) {
    return { status: -1, stdout: '', stderr: `invalid wsl distro: ${String(distro)}` }
  }
  return runWslSync(['-d', distro, '--cd', wslCwd, '--', ...args], opts)
}

/** Async variant used for probes that may run in parallel. */
export function runWslDistroAsync(
  distro: string,
  args: string[],
  opts: { timeout?: number } = {},
): Promise<WslExecResult> {
  if (!isValidWslDistroName(distro)) {
    return Promise.resolve({ status: -1, stdout: '', stderr: `invalid wsl distro: ${String(distro)}` })
  }
  return new Promise((resolve) => {
    const child = spawn(WSL_EXE, ['-d', distro, '--', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({
        status: -1,
        stdout: decodeWslOutput(Buffer.concat(stdoutChunks)),
        stderr: decodeWslOutput(Buffer.concat(stderrChunks)) + '\n[wsl] timed out',
      })
    }, opts.timeout ?? 20000)
    child.stdout?.on('data', (c: Buffer) => {
      stdoutChunks.push(c)
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderrChunks.push(c)
    })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ status: -1, stdout: '', stderr: errorMessage(e) || 'wsl spawn error' })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        status: code,
        stdout: decodeWslOutput(Buffer.concat(stdoutChunks)),
        stderr: decodeWslOutput(Buffer.concat(stderrChunks)),
      })
    })
  })
}

/** WSL home directory (e.g. `/home/user`). Returns null when the distro is unusable. */
const wslHomeCache = new Map<string, { at: number; value: string | null }>()
const wslShellCache = new Map<string, { at: number; value: string }>()

const WSL_ENV_CACHE_TTL_MS = 60_000

/** Invalidate the per-distro home/shell caches (runtime switch, tests, re-probe). */
export function invalidateWslEnvCaches(distro?: string): void {
  if (distro) {
    wslHomeCache.delete(distro)
    wslShellCache.delete(distro)
    return
  }
  wslHomeCache.clear()
  wslShellCache.clear()
}

export function wslHomeDirSync(distro: string): string | null {
  const cached = wslHomeCache.get(distro)
  if (cached && Date.now() - cached.at < WSL_ENV_CACHE_TTL_MS) return cached.value
  const r = runWslDistroSync(distro, ['bash', '-lc', 'printf %s "$HOME"'])
  const home = r.stdout.trim()
  const value = r.status === 0 && home.startsWith('/') ? home : null
  wslHomeCache.set(distro, { at: Date.now(), value })
  return value
}

/**
 * Default login shell of the distro's user (e.g. `/usr/bin/zsh` -> `zsh`).
 * Follows the system default so probes/workers run under the same shell the
 * user configured (bash-only setups get `bash`, zsh-heavy setups get `zsh`).
 * Falls back to `bash` when it cannot be determined.
 *
 * Uses a simple single-quoted command (no nested quoting) so it is not
 * corrupted by `wsl.exe`'s Windows command-line arg handling.
 */
export function wslDefaultShellSync(distro: string): string {
  const cached = wslShellCache.get(distro)
  if (cached && Date.now() - cached.at < WSL_ENV_CACHE_TTL_MS) return cached.value
  const r = runWslDistroSync(distro, ['bash', '-lc', 'printf %s "$SHELL"'])
  const raw = r.stdout.trim().split('\n').filter(Boolean).pop()?.trim()
  const base = raw?.split('/').pop()
  const value =
    base && /^[a-z][a-z0-9-]*$/i.test(base) && base !== 'false' && base !== 'nologin'
      ? base
      : 'bash'
  wslShellCache.set(distro, { at: Date.now(), value })
  return value
}
