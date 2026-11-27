export const DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS = 0
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN = 0
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX = 50

/** Conversation history shows everything inside the last N user turns; scrolling up reveals N more. */
export const TIMELINE_USER_MESSAGE_STYLES = ['bubble', 'prompt-card'] as const
export type TimelineUserMessageStyle = (typeof TIMELINE_USER_MESSAGE_STYLES)[number]
export const DEFAULT_TIMELINE_USER_MESSAGE_STYLE: TimelineUserMessageStyle = 'bubble'

export function normalizeTimelineUserMessageStyle(raw: unknown): TimelineUserMessageStyle {
  return raw === 'prompt-card' ? 'prompt-card' : DEFAULT_TIMELINE_USER_MESSAGE_STYLE
}

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
