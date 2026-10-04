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
/**
 * Rows of `history` (from the end) that hold its last `turns` user turns: everything from
 * the `turns`-th last user message on. Fewer turns than asked → the whole history.
 */
export function rowsForTurns(history: readonly { type: string }[], turns: number): number {
  if (turns <= 0) return 0
  let seen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].type === 'user-message' && ++seen === turns) return history.length - i
  }
  return history.length
}

/**
 * Turns needed so the window includes the row `rows` from the end (view jumps): count user
 * messages from the turn that row belongs to through the end. A row before any user
 * message (session preamble) needs every turn plus one.
 */
export function turnsForRows(items: readonly { type: string }[], rows: number): number {
  const target = Math.max(0, items.length - rows)
  let start = -1
  for (let i = target; i >= 0; i--) {
    if (items[i]?.type === 'user-message') {
      start = i
      break
    }
  }
  let turns = 0
  for (let i = Math.max(0, start); i < items.length; i++) if (items[i].type === 'user-message') turns++
  return start < 0 ? turns + 1 : turns
}
