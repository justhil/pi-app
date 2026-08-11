import type { TimelineItem } from '@renderer/stores/ui-store-types'

/**
 * Non-destructive "view" jumps from the session tree into the timeline.
 *
 * Single-clicking a tree node (or pressing Enter in the tree overlay) must
 * scroll the timeline to that node's message WITHOUT rewinding: the session
 * leaf never changes, the composer is never touched, and the timeline always
 * keeps representing the real latest state.
 *
 * The tree side only dispatches an event with the target entry id; the
 * Timeline component owns the viewport and reacts here.
 */
export const TIMELINE_VIEW_ENTRY_EVENT = 'pi-desktop:timeline-view-entry'

export interface TimelineViewEntryDetail {
  entryId: string
}

export function requestTimelineViewEntry(entryId: string): void {
  window.dispatchEvent(
    new CustomEvent<TimelineViewEntryDetail>(TIMELINE_VIEW_ENTRY_EVENT, {
      detail: { entryId },
    }),
  )
}

/** Upper bound of the read-only history chunk fetched to reveal an old node. */
export const VIEW_REVEAL_CHUNK_LIMIT = 400

export type ViewRevealPlan =
  | { kind: 'none'; reason: 'no-session' | 'covered' }
  /** Target is in the loaded store but outside the render window. */
  | { kind: 'scroll'; requiredRenderCount: number }
  /** Target is not loaded yet — the caller must fetch history up to it first. */
  | { kind: 'load'; entryId: string }

export function planViewReveal(
  entryId: string,
  items: TimelineItem[],
  renderCount: number,
  sessionFile: string | null,
): ViewRevealPlan {
  if (!sessionFile) return { kind: 'none', reason: 'no-session' }
  const idx = items.findIndex((it) => it.sessionEntryId === entryId || it.id === entryId)
  if (idx < 0) return { kind: 'load', entryId }
  const required = items.length - idx
  return required > renderCount
    ? { kind: 'scroll', requiredRenderCount: required }
    : { kind: 'none', reason: 'covered' }
}

/**
 * Items to prepend so the store stays contiguous when revealing an old node:
 * everything from the fetched chunk that is not already present (the chunk is
 * strictly older than the loaded tail, so order is preserved).
 */
export function missingOlderItems(fetched: TimelineItem[], existing: TimelineItem[]): TimelineItem[] {
  if (!fetched.length) return []
  // 去重以稳定的 sessionEntryId 优先：磁盘投影每次都会生成新的 hist-* id，
  // 若按 id 去重，重读尾部时同一批条目的 hist id 不同会被当成新增重复 prepend。
  const known = new Set(existing.map((it) => it.sessionEntryId ?? it.id ?? ''))
  return fetched.filter((it) => !known.has(it.sessionEntryId ?? it.id ?? ''))
}

/**
 * Guard against revealing nodes that lie AFTER the current session leaf
 * (visible in the tree after a rewind, but newer than the loaded tail).
 * Peeking forward would break the "timeline always represents the real
 * latest" invariant, so such jumps are silently dropped.
 */
export function isTargetNewerThanStore(
  fetched: TimelineItem[],
  existingTail: TimelineItem | null,
): boolean {
  if (!existingTail) return false
  const tailEntryId = existingTail.sessionEntryId ?? existingTail.id
  if (!tailEntryId) return false
  return fetched.some(
    (it) => it.sessionEntryId === tailEntryId || it.id === tailEntryId,
  )
}

export interface TailSnapshot {
  id?: string
  type?: string
}

/**
 * Cancel rule for a pending view jump: if the user sent a new message while
 * the read-only chunk was loading, do not yank them away from their input.
 */
export function userSentSince(captured: TailSnapshot | null, current: TailSnapshot | null): boolean {
  if (!captured || !current) return false
  return current.type === 'user-message' && !!current.id && current.id !== captured.id
}
