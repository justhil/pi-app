import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

/**
 * Sessions whose turn ended while unfocused. On the next hydrate their disk tail is
 * authoritative: the live cache may have missed rows, and length-based live merges would
 * otherwise keep the switch-away snapshot (#99).
 */
const diskAuthoritative = new Set<string>()

function key(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

export function markSessionDiskAuthoritative(sessionFile: string | null | undefined): void {
  const k = key(sessionFile)
  if (k) diskAuthoritative.add(k)
}

export function isSessionDiskAuthoritative(sessionFile: string | null | undefined): boolean {
  const k = key(sessionFile)
  return !!k && diskAuthoritative.has(k)
}

export function clearSessionDiskAuthoritative(sessionFile?: string | null): void {
  if (sessionFile === undefined) {
    diskAuthoritative.clear()
    return
  }
  const k = key(sessionFile)
  if (k) diskAuthoritative.delete(k)
}
