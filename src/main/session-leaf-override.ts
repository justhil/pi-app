import { normalizeSessionKey } from './worker-session-key'

/**
 * In-memory leaf tip after navigateTree / rewind.
 * pi SessionManager only keeps leaf in RAM — reopening the JSONL resets leaf to
 * the last file entry. We remember the tip so getMessages (disk) and loadSession
 * can re-branch without spawning a worker just for preview.
 */
const leafBySession = new Map<string, string | null>()

export function setSessionLeafOverride(
  sessionFile: string | null | undefined,
  leafId: string | null | undefined,
): void {
  const key = normalizeSessionKey(sessionFile || '')
  if (!key) return
  if (leafId === undefined) {
    leafBySession.delete(key)
    return
  }
  leafBySession.set(key, leafId)
}

export function getSessionLeafOverride(
  sessionFile: string | null | undefined,
): string | null | undefined {
  const key = normalizeSessionKey(sessionFile || '')
  if (!key) return undefined
  if (!leafBySession.has(key)) return undefined
  return leafBySession.get(key) ?? null
}

export function clearSessionLeafOverride(sessionFile?: string | null): void {
  if (!sessionFile) {
    leafBySession.clear()
    return
  }
  const key = normalizeSessionKey(sessionFile)
  if (key) leafBySession.delete(key)
}
