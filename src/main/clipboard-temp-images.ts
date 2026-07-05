import { existsSync, unlinkSync } from 'fs'

const tracked = new Set<string>()

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
  } catch (e) {
    /* best effort */
  }
}

export function releaseAllClipboardTempImages(): void {
  for (const p of [...tracked]) {
    releaseClipboardTempImage(p)
  }
}

export function trackedClipboardTempImageCount(): number {
  return tracked.size
}