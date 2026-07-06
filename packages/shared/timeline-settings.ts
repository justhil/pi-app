export const DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS = 15
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN = 1
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX = 50

export function normalizeTimelineMaxAutoExpandedTools(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS
  return Math.min(
    TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MAX,
    Math.max(TIMELINE_MAX_AUTO_EXPANDED_TOOLS_MIN, Math.floor(n)),
  )
}