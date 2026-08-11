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
    const cap = 64 * 1024
    const chunks: Buffer[] = []
    const scratch = Buffer.allocUnsafe(4 * 1024)
    let total = 0
    let raw = ''
    while (total < cap) {
      const bytesRead = readSync(fd, scratch, 0, Math.min(scratch.length, cap - total), total)
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
