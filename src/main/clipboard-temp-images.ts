import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const tracked = new Set<string>()

/** Durable dir under userData — OS temp may be cleaned while the agent still needs the file. */
export function resolveClipboardImageDir(): string {
  const dir = join(app.getPath('userData'), 'clipboard-images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function writeClipboardTempImage(data: Buffer, ext: string): string {
  const safeExt = (ext || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
  const filePath = join(resolveClipboardImageDir(), `pi-clipboard-${randomUUID()}.${safeExt}`)
  writeFileSync(filePath, data)
  trackClipboardTempImage(filePath)
  return filePath
}

export function trackClipboardTempImage(path: string): void {
  const p = String(path || '').trim()
  if (!p) return
  tracked.add(p)
}

export function releaseClipboardTempImage(path: string): void {
  const p = String(path || '').trim()
  if (!p) return
  tracked.delete(p)
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* best effort */
  }
}

/**
 * Best-effort cleanup of tracked files (e.g. app quit).
 * Must NOT run immediately after prompt.send — agent tools still need the paths.
 */
export function releaseAllClipboardTempImages(): void {
  for (const p of [...tracked]) {
    releaseClipboardTempImage(p)
  }
}

/** Remove clipboard images older than maxAgeMs (default 7d). Safe to call on startup. */
export function pruneStaleClipboardImages(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  let removed = 0
  try {
    const dir = resolveClipboardImageDir()
    const now = Date.now()
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('pi-clipboard-')) continue
      const full = join(dir, name)
      try {
        const { mtimeMs } = statSync(full)
        if (now - mtimeMs > maxAgeMs) {
          unlinkSync(full)
          tracked.delete(full)
          removed++
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir missing etc. */
  }
  return removed
}

export function trackedClipboardTempImageCount(): number {
  return tracked.size
}
