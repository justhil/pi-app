import type { TimelineItem } from '@renderer/stores/ui-store-types'

const DEFAULT_LIVE_TAIL_MAX = 32

/**
 * Split displayed timeline into stable history vs live tail (Paseo head/tail render model lite).
 * While streaming, the current turn (from last user message) stays fully mounted.
 */
export function splitTimelineRenderSegments(
  items: TimelineItem[],
  opts: { streamingAssistantId: string | null; agentRunning?: boolean },
): { history: TimelineItem[]; liveHead: TimelineItem[] } {
  const streaming = !!opts.streamingAssistantId || opts.agentRunning
  if (!streaming || items.length === 0) {
    return { history: items, liveHead: [] }
  }

  let liveStart = Math.max(0, items.length - DEFAULT_LIVE_TAIL_MAX)
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'user-message') {
      liveStart = i
      break
    }
  }
  return {
    history: items.slice(0, liveStart),
    liveHead: items.slice(liveStart),
  }
}

export function sliceHistoryForViewport(history: TimelineItem[], renderCount: number): TimelineItem[] {
  if (renderCount <= 0) return []
  return history.slice(Math.max(0, history.length - renderCount))
}