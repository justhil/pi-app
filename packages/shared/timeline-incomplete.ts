/**
 * Incomplete / crash-mid-stream timeline helpers.
 * Force-quit during streaming often leaves an empty assistant leaf in JSONL.
 * UI must keep that leaf visible and rewind to the preceding user entry.
 */

export type IncompleteTimelineRow = {
  id?: string
  type?: string
  text?: string
  thinkingText?: string
  sessionEntryId?: string
  incomplete?: boolean
  stopReason?: string
}

function assistantHasBody(row: IncompleteTimelineRow): boolean {
  return !!(String(row.text || '').trim() || String(row.thinkingText || '').trim())
}

function isTerminalStopReason(stopReason: string | undefined): boolean {
  const reason = String(stopReason || '').toLowerCase()
  // pi uses various terminal reasons; treat common "done" values as complete
  return reason === 'end' || reason === 'stop' || reason === 'length' || reason === 'tooluse'
}

/**
 * Mark the leaf-side empty assistant (and its run) as incomplete so the UI
 * shows an interrupted placeholder and keeps rewind targets.
 */
export function markTrailingIncompleteAssistants<T extends IncompleteTimelineRow>(items: T[]): T[] {
  if (!items.length) return items

  let lastAssistantIndex = -1
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.type === 'assistant-message') {
      lastAssistantIndex = index
      break
    }
    // tool-call / error after assistant still belong to the same turn
    if (items[index]?.type === 'user-message') break
  }
  if (lastAssistantIndex < 0) return items

  const leafAssistant = items[lastAssistantIndex]
  if (assistantHasBody(leafAssistant)) {
    // Partial text mid-stream still counts as interrupted if stopReason says so,
    // or if explicitly incomplete already.
    if (leafAssistant.incomplete || leafAssistant.stopReason === 'aborted' || leafAssistant.stopReason === 'error') {
      return items
    }
    return items
  }

  // Empty leaf assistant → always mark incomplete (crash / force-quit / abort before tokens)
  if (isTerminalStopReason(leafAssistant.stopReason) && !leafAssistant.incomplete) {
    // empty with a "complete" stopReason is still unusable — mark interrupted
  }

  const next = items.slice() as T[]
  // Walk back through same-turn empty assistants (rare multi-empty merge artifacts)
  for (let index = lastAssistantIndex; index >= 0; index--) {
    const row = next[index]
    if (row.type === 'user-message') break
    if (row.type !== 'assistant-message') continue
    if (assistantHasBody(row)) break
    next[index] = {
      ...row,
      incomplete: true,
      stopReason: row.stopReason || 'interrupted',
    }
  }
  return next
}

/**
 * Prefer the previous user entry for rewind when the leaf is an empty/incomplete
 * assistant — navigating to the empty leaf itself leaves the session unusable.
 */
export function resolveRewindTargetEntryId(
  items: IncompleteTimelineRow[],
  item: IncompleteTimelineRow,
): string | undefined {
  const ownId = item.sessionEntryId
  const emptyIncomplete =
    item.type === 'assistant-message' &&
    !assistantHasBody(item) &&
    (!!item.incomplete ||
      item.stopReason === 'aborted' ||
      item.stopReason === 'interrupted' ||
      item.stopReason === 'error' ||
      !!ownId)

  if (!emptyIncomplete) return ownId

  const itemIndex = items.findIndex((row) => row === item || (item.id && row.id === item.id))
  const searchFrom = itemIndex >= 0 ? itemIndex - 1 : items.length - 1
  for (let index = searchFrom; index >= 0; index--) {
    const row = items[index]
    if (row.type === 'user-message' && row.sessionEntryId) {
      return row.sessionEntryId
    }
  }
  return ownId
}

export function isInterruptedAssistantRow(item: IncompleteTimelineRow): boolean {
  if (item.type !== 'assistant-message') return false
  const stopReason = String(item.stopReason || '')
  if (item.incomplete) return true
  if (stopReason === 'aborted' || stopReason === 'interrupted' || stopReason === 'error') return true
  return !assistantHasBody(item)
}
