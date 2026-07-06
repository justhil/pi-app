/** Minimal timeline row shape for projection (Worker JSON + Renderer TimelineItem). */
export type ProjectableTimelineItem = {
  id: string
  type: string
  text?: string
  thinkingText?: string
  toolName?: string
  toolCallId?: string
  toolPhase?: string
  toolOutput?: string
  toolDetails?: unknown
  toolArgs?: unknown
  runId?: string
  isError?: boolean
  sessionEntryId?: string
  timestamp?: number
}