import type { TimelineItem } from '@renderer/stores/ui-store-types'

export type TurnTiming = {
  startedAt: number
  completedAt: number
  durationMs: number
}

/** Per user-turn timing (Paseo deriveStreamTurnTiming, adapted to TimelineItem). */
export function deriveTurnTimingsFromItems(items: TimelineItem[]): Map<string, TurnTiming> {
  const byTurnId = new Map<string, TurnTiming>()
  let userAt: number | null = null
  let lastAt: number | null = null
  let turnId: string | null = null

  const flush = () => {
    if (userAt == null || lastAt == null || !turnId) return
    byTurnId.set(turnId, {
      startedAt: userAt,
      completedAt: lastAt,
      durationMs: Math.max(0, lastAt - userAt),
    })
  }

  for (const item of items) {
    if (item.type === 'user-message') {
      flush()
      userAt = item.timestamp || 0
      lastAt = userAt
      turnId = String(item.sessionEntryId || item.id)
      continue
    }
    if (userAt == null || !turnId) continue
    const ts = item.timestamp || 0
    if (ts) lastAt = Math.max(lastAt ?? ts, ts)
  }
  flush()
  return byTurnId
}

export function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}