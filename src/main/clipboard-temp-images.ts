import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
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

/**
 * Attachment from a phone: keeps a readable original name after the `pi-clipboard-<id>` prefix so
 * the agent (and the desktop chip) can tell files apart; same dir, TTL and cleanup as clipboard images.
 */
export function writeRemoteAttachment(data: Uint8Array, name: string): string {
  const safe = (name || 'file').normalize('NFC').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file'
  const filePath = join(resolveClipboardImageDir(), `pi-clipboard-${randomUUID().slice(0, 8)}-${safe}`)
  writeFileSync(filePath, data)
  trackClipboardTempImage(filePath)
  return filePath
}

const ATTACHMENT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', md: 'text/markdown', txt: 'text/plain' }

/** Read a `pi-clipboard-*` file for a phone; anything outside the attachment dir (or a symlink out of it) is refused. */
export function readRemoteAttachment(path: string): { bytes: Buffer; mime: string } | null {
  try {
    const dir = realpathSync(resolveClipboardImageDir())
    const real = realpathSync(path)
    if (dirname(real) !== dir || !basename(real).startsWith('pi-clipboard-')) return null
    const ext = (real.split('.').pop() || '').toLowerCase()
    return { bytes: readFileSync(real), mime: ATTACHMENT_MIME[ext] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

/** Text attachment (e.g. a page captured from the built-in browser) beside clipboard images. */
export function writeClipboardTempText(text: string, ext = 'md'): string {
  const safeExt = (ext || 'md').replace(/[^a-z0-9]/gi, '') || 'md'
  const filePath = join(resolveClipboardImageDir(), `pi-clipboard-${randomUUID()}.${safeExt}`)
  writeFileSync(filePath, text, 'utf8')
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
