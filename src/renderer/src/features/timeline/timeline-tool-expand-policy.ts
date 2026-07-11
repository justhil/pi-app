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
 * Auto-expand budget for tools in the active run.
 * maxExpanded=0 → never auto-expand.
 * While agent is running: expand the last N tools of the current run (any phase).
 * User click override lives in toolExpandBySession and always wins in ToolCallRow.
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
  const tail = runSlots.slice(-max)
  return new Set(tail.map((slot) => slot.id))
}
