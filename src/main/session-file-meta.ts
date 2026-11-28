import { open, type FileHandle } from 'node:fs/promises'
import { windowsPathToWsl, wslWindowsPathDistro } from '@shared/wsl-path'
import { isSshWindowsPath } from './ssh/ssh-exec'
import { runWslDistroAsync } from './wsl/wsl-exec'

export type SessionFileMeta = {
  sessionId: string
  cwd: string | null
}

const sshSessionMetaCache = new Map<string, SessionFileMeta>()

function metaCacheKey(sessionFile: string): string {
  return sessionFile.replace(/\\/g, '/').replace(/^\/+/, '//').toLowerCase()
}

export function rememberSessionMeta(sessionFile: string, meta: SessionFileMeta): void {
  if (!sessionFile || !meta.sessionId) return
  sshSessionMetaCache.set(metaCacheKey(sessionFile), meta)
}

function parseFirstSessionLine(raw: string): SessionFileMeta | null {
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
  if (!firstLine) return null
  try {
    const header = JSON.parse(firstLine) as { type?: string; id?: unknown; cwd?: unknown }
    if (header.type !== 'session' || !header.id) return null
    const cwd = typeof header.cwd === 'string' && header.cwd.trim() ? header.cwd.trim() : null
    return { sessionId: String(header.id), cwd }
  } catch {
    return null
  }
}

export function sessionFilePathForFs(sessionFile: string): string {
  if (process.platform !== 'win32' || !sessionFile.startsWith('//')) return sessionFile
  return `\\\\${sessionFile.slice(2).replace(/\//g, '\\')}`
}

export async function readSessionMetaFromFile(sessionFile: string): Promise<SessionFileMeta | null> {
  if (isSshWindowsPath(sessionFile)) {
    const cached = sshSessionMetaCache.get(metaCacheKey(sessionFile))
    if (cached) return cached
    const distro = wslWindowsPathDistro(sessionFile)
    const remotePath = distro ? windowsPathToWsl(distro, sessionFile) : ''
    if (!distro || !remotePath) return null
    const res = await runWslDistroAsync(distro, ['head', '-n', '10', '--', remotePath], { timeout: 10000 })
    if (res.status !== 0) return null
    const parsed = parseFirstSessionLine(res.stdout)
    if (parsed) rememberSessionMeta(sessionFile, parsed)
    return parsed
  }
  const filePath = sessionFilePathForFs(sessionFile)
  if (!filePath) return null
  let handle: FileHandle | null = null
  try {
    // Session JSONL can be large. Metadata lives in its first non-empty line, so
    // only read a bounded prefix, asynchronously (UNC reads must not block Main).
    handle = await open(filePath, 'r')
    const cap = 64 * 1024
    const chunks: Buffer[] = []
    const scratch = Buffer.allocUnsafe(4 * 1024)
    let total = 0
    let raw = ''
    while (total < cap) {
      const { bytesRead } = await handle.read(scratch, 0, Math.min(scratch.length, cap - total), total)
      if (bytesRead === 0) break
      chunks.push(Buffer.from(scratch.subarray(0, bytesRead)))
      total += bytesRead
      raw = Buffer.concat(chunks, total).toString('utf8')
      // Stop once the buffered prefix contains a complete non-empty line; a bare
      // newline is not enough (the file may start with blank lines).
      if (/\S[^\n]*\n/.test(raw)) break
    }
    const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.trim() ?? ''
    if (!firstLine) return null
    const header = JSON.parse(firstLine) as {
      type?: string
      id?: unknown
      cwd?: unknown
    }
    if (header.type !== 'session' || !header.id) return null
    const cwd = typeof header.cwd === 'string' && header.cwd.trim() ? header.cwd.trim() : null
    return {
      sessionId: String(header.id),
      cwd,
    }
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

export async function readSessionIdFromFile(sessionFile: string): Promise<string | null> {
  return (await readSessionMetaFromFile(sessionFile))?.sessionId ?? null
}
