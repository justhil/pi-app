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
