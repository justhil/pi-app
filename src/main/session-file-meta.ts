import { closeSync, existsSync, openSync, readSync } from 'fs'

export type SessionFileMeta = {
  sessionId: string
  cwd: string | null
}

export function readSessionMetaFromFile(sessionFile: string): SessionFileMeta | null {
  if (!sessionFile || !existsSync(sessionFile)) return null
  let fd: number | null = null
  try {
    // Session JSONL can be large. Metadata lives in its first non-empty line, so
    // never synchronously read/split the whole transcript on an IPC hot path.
    fd = openSync(sessionFile, 'r')
    const chunks: Buffer[] = []
    const chunk = Buffer.allocUnsafe(4 * 1024)
    let total = 0
    let newline = -1
    while (total < 64 * 1024 && newline < 0) {
      const bytesRead = readSync(fd, chunk, 0, Math.min(chunk.length, 64 * 1024 - total), total)
      if (bytesRead === 0) break
      const copy = Buffer.from(chunk.subarray(0, bytesRead))
      chunks.push(copy)
      const localNewline = copy.indexOf(0x0a)
      if (localNewline >= 0) newline = total + localNewline
      total += bytesRead
    }
    const raw = Buffer.concat(chunks, total).toString('utf8')
    const lines = raw.split(/\r?\n/)
    const firstLine = lines.find((line) => line.trim())?.trim() ?? ''
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
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

export function readSessionIdFromFile(sessionFile: string): string | null {
  return readSessionMetaFromFile(sessionFile)?.sessionId ?? null
}
