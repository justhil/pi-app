import {
  DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS,
  normalizeTimelineMaxAutoExpandedTools,
} from '@shared/timeline-settings'

/** @deprecated 使用 DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS 或设置项 */
export const TIMELINE_MAX_AUTO_EXPANDED_TOOLS = DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS

export { normalizeTimelineMaxAutoExpandedTools }

export type ToolExpandSlot = {
  id: string
  runId?: string
  toolPhase?: string
}

/**
 * Auto-expand budget for live tools.
 * maxExpanded=0 → never auto-expand (Cursor default: collapsed, subtle live pulse only).
 */
export function pickAutoExpandedToolIds(
  slots: ToolExpandSlot[],
  opts: {
    agentRunning: boolean
    activeRunId: string | null | undefined
    maxExpanded?: number
  },
): Set<string> {
  const max = opts.maxExpanded ?? DEFAULT_TIMELINE_MAX_AUTO_EXPANDED_TOOLS
  if (max <= 0) return new Set()
  if (!opts.agentRunning || !opts.activeRunId) return new Set()

  const runSlots = slots.filter((slot) => slot.runId && slot.runId === opts.activeRunId)
  const eligible = runSlots.filter(
    (slot) => slot.toolPhase === 'start' || slot.toolPhase === 'update',
  )
  const pool = eligible.length > 0 ? eligible : runSlots
  const tail = pool.slice(-max)
  return new Set(tail.map((slot) => slot.id))
}
