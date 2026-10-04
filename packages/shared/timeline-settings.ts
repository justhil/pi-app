export const DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS = 0
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN = 0
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX = 50

/** Conversation history shows everything inside the last N user turns; scrolling up reveals N more. */
export const DEFAULT_TIMELINE_VISIBLE_TURNS = 10
export const TIMELINE_VISIBLE_TURNS_MIN = 1
export const TIMELINE_VISIBLE_TURNS_MAX = 200

export function normalizeTimelineVisibleTurns(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TIMELINE_VISIBLE_TURNS
  return Math.min(TIMELINE_VISIBLE_TURNS_MAX, Math.max(TIMELINE_VISIBLE_TURNS_MIN, Math.floor(n)))
}

export function normalizeTimelineMaxAutoExpandedTools(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS
  return Math.min(
    TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX,
    Math.max(TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN, Math.floor(n)),
  )
}
