import { normalizeSessionFileKey, sessionFilesEqual } from '@renderer/lib/session-file-key'

export type SessionAttention = 'idle' | 'working' | 'needs-you' | 'done'

export type SessionAttentionFacts = {
  running: boolean
  waitingUi: boolean
  settledUnseen: boolean
  viewing: boolean
}

/** Pure four-state projection. needs-you covers working. Viewing clears done. */
export function reduceSessionAttention(facts: SessionAttentionFacts): SessionAttention {
  if (facts.waitingUi) return 'needs-you'
  if (facts.running) return 'working'
  if (facts.viewing) return 'idle'
  if (facts.settledUnseen) return 'done'
  return 'idle'
}

export function attentionKey(sessionFile: string | null | undefined): string {
  return normalizeSessionFileKey(sessionFile) || String(sessionFile || '').trim()
}

export function selectSessionAttention(
  sessionFile: string | null | undefined,
  attention: Record<string, SessionAttention>,
): SessionAttention {
  const key = attentionKey(sessionFile)
  if (!key) return 'idle'
  if (attention[key]) return attention[key]
  for (const [existing, value] of Object.entries(attention)) {
    if (sessionFilesEqual(existing, sessionFile)) return value
  }
  return 'idle'
}

export function countAttention(
  attention: Record<string, SessionAttention>,
): { working: number; needsYou: number; done: number } {
  let working = 0
  let needsYou = 0
  let done = 0
  for (const value of Object.values(attention)) {
    if (value === 'working') working += 1
    else if (value === 'needs-you') needsYou += 1
    else if (value === 'done') done += 1
  }
  return { working, needsYou, done }
}

export function listAttentionSessions(
  attention: Record<string, SessionAttention>,
  kind: SessionAttention,
): string[] {
  return Object.entries(attention)
    .filter(([, value]) => value === kind)
    .map(([file]) => file)
}

/** 1 hour retention window for recently active sessions in the sidebar drawer. */
export const RECENT_ACTIVE_WINDOW_MS = 60 * 60 * 1000

export function pruneExpiredRecentSessions(
  recent: Record<string, number> | undefined,
  now = Date.now(),
  windowMs = RECENT_ACTIVE_WINDOW_MS,
): Record<string, number> {
  if (!recent) return {}
  const cutoff = now - windowMs
  const out: Record<string, number> = {}
  for (const [rawKey, ts] of Object.entries(recent)) {
    const key = attentionKey(rawKey)
    if (!key || typeof ts !== 'number' || !Number.isFinite(ts) || ts < cutoff) continue
    out[key] = Math.max(out[key] ?? 0, ts)
  }
  return out
}

export interface ActiveDrawerEntry {
  sessionFile: string
  attention: SessionAttention
  lastActiveAt: number
}

function drawerTier(attention: SessionAttention): number {
  if (attention === 'needs-you') return 0
  if (attention === 'working') return 1
  // 'done' (unread) and 'idle' (read within 1h) share tier 2 so clicking a 'done' session
  // to read it never reorders the list under the user's cursor.
  return 2
}

/**
 * Build the ordered list of sessions for the sidebar pull-up drawer:
 * - Currently running ('working') or waiting on user ('needs-you')
 * - Finished unread ('done')
 * - Ran within the last 1 hour (even after being viewed/read)
 */
export function buildActiveDrawerEntries(input: {
  attention: Record<string, SessionAttention>
  recentActiveAt?: Record<string, number>
  now?: number
  windowMs?: number
}): ActiveDrawerEntry[] {
  const now = input.now ?? Date.now()
  const windowMs = input.windowMs ?? RECENT_ACTIVE_WINDOW_MS
  const cutoff = now - windowMs
  const byKey = new Map<string, ActiveDrawerEntry>()

  for (const [rawFile, value] of Object.entries(input.attention || {})) {
    if (value === 'idle') continue
    const key = attentionKey(rawFile)
    if (!key) continue
    byKey.set(key, {
      sessionFile: key,
      attention: value,
      lastActiveAt: input.recentActiveAt?.[key] ?? input.recentActiveAt?.[rawFile] ?? 0,
    })
  }

  for (const [rawFile, ts] of Object.entries(input.recentActiveAt || {})) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < cutoff) continue
    const key = attentionKey(rawFile)
    if (!key) continue
    const existing = byKey.get(key)
    if (existing) {
      if (ts > existing.lastActiveAt) existing.lastActiveAt = ts
    } else {
      byKey.set(key, {
        sessionFile: key,
        attention: selectSessionAttention(key, input.attention || {}),
        lastActiveAt: ts,
      })
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const tierDiff = drawerTier(a.attention) - drawerTier(b.attention)
    if (tierDiff !== 0) return tierDiff
    if (b.lastActiveAt !== a.lastActiveAt) return b.lastActiveAt - a.lastActiveAt
    return a.sessionFile.localeCompare(b.sessionFile)
  })
}
