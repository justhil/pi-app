import type { ProjectableTimelineItem } from './timeline-projection-types'

function sameRun(a: ProjectableTimelineItem, b: ProjectableTimelineItem): boolean {
  if (a.runId && b.runId) return a.runId === b.runId
  return true
}

function mergeAssistant(
  existing: ProjectableTimelineItem,
  incoming: ProjectableTimelineItem,
): ProjectableTimelineItem {
  const text = [existing.text, incoming.text].filter(Boolean).join('')
  const thinkingText = [existing.thinkingText, incoming.thinkingText].filter(Boolean).join('')
  return {
    ...existing,
    text: text || existing.text,
    thinkingText: thinkingText || existing.thinkingText,
    sessionEntryId: incoming.sessionEntryId ?? existing.sessionEntryId,
    timestamp: incoming.timestamp ?? existing.timestamp,
  }
}

function mergeTool(
  existing: ProjectableTimelineItem,
  incoming: ProjectableTimelineItem,
): ProjectableTimelineItem {
  const phase =
    incoming.toolPhase === 'end' || existing.toolPhase === 'end' ? 'end' : incoming.toolPhase ?? existing.toolPhase
  return {
    ...existing,
    ...incoming,
    toolPhase: phase,
    toolOutput: incoming.toolOutput?.length ? incoming.toolOutput : existing.toolOutput,
    toolDetails: incoming.toolDetails ?? existing.toolDetails,
    toolArgs: incoming.toolArgs ?? existing.toolArgs,
    isError: incoming.isError ?? existing.isError,
    sessionEntryId: incoming.sessionEntryId ?? existing.sessionEntryId,
  }
}

/**
 * Collapse adjacent assistant deltas and tool start/end into display rows.
 * Does not mutate input.
 */
export function projectTimelineItems<T extends ProjectableTimelineItem>(items: T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (item.type === 'assistant-message' && prev?.type === 'assistant-message' && sameRun(prev, item)) {
      out[out.length - 1] = mergeAssistant(prev, item) as T
      continue
    }
    if (item.type === 'tool-call' && item.toolCallId && prev?.type === 'tool-call' && prev.toolCallId === item.toolCallId) {
      out[out.length - 1] = mergeTool(prev, item) as T
      continue
    }
    out.push({ ...item })
  }
  return out
}