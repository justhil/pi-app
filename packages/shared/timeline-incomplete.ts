/**
 * Incomplete / crash-mid-stream timeline helpers.
 * Force-quit during streaming often leaves an empty assistant leaf in JSONL.
 * UI must keep that leaf visible and rewind to the preceding user entry.
 *
 * Important: mid-turn assistants that only request tools (empty text/thinking,
 * followed by tool-call rows) are normal agent loop bridges — never treat them
 * as incomplete or they split the tool cluster and flash a false "interrupted" banner.
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
  return (
    reason === 'end' ||
    reason === 'stop' ||
    reason === 'length' ||
    reason === 'tooluse' ||
    reason === 'tool_use' ||
    reason === 'tool-calls' ||
    reason === 'toolcalls'
  )
}

function isErrorStopReason(stopReason: string | undefined): boolean {
  const reason = String(stopReason || '').toLowerCase()
  return reason === 'aborted' || reason === 'interrupted' || reason === 'error'
}

/**
 * Empty assistant with tools still following in the same turn = tool-use bridge,
 * not a crash leaf. Structure wins over a stale incomplete/interrupted flag.
 */
export function isToolBridgeEmptyAssistant(
  items: IncompleteTimelineRow[],
  index: number,
): boolean {
  const row = items[index]
  if (!row || row.type !== 'assistant-message') return false
  if (assistantHasBody(row)) return false
  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const next = items[cursor]
    if (next.type === 'tool-call') return true
    if (next.type === 'user-message') return false
    if (next.type === 'assistant-message' && assistantHasBody(next)) return false
  }
  return false
}

/**
 * Mark the leaf-side empty assistant as incomplete so the UI shows an interrupted
 * placeholder and keeps rewind targets. Never marks mid-turn tool-bridge empties.
 */
export function markTrailingIncompleteAssistants<T extends IncompleteTimelineRow>(items: T[]): T[] {
  if (!items.length) return items

  // Heal false incomplete on tool-bridge empty assistants (history reloads / old data)
  let needsBridgeClean = false
  for (let index = 0; index < items.length; index++) {
    const row = items[index]
    if (
      row.type === 'assistant-message' &&
      row.incomplete &&
      isToolBridgeEmptyAssistant(items, index)
    ) {
      needsBridgeClean = true
      break
    }
  }
  let working = items
  if (needsBridgeClean) {
    const cleaned = items.slice() as T[]
    for (let index = 0; index < cleaned.length; index++) {
      const row = cleaned[index]
      if (
        row.type === 'assistant-message' &&
        row.incomplete &&
        isToolBridgeEmptyAssistant(cleaned, index)
      ) {
        cleaned[index] = {
          ...row,
          incomplete: undefined,
          // Drop false interrupted stopReason on healed bridge rows
          stopReason:
            row.stopReason === 'interrupted' || row.stopReason === 'aborted'
              ? isTerminalStopReason(row.stopReason)
                ? row.stopReason
                : undefined
              : row.stopReason,
        }
      }
    }
    working = cleaned
  }

  let lastAssistantIndex = -1
  for (let index = working.length - 1; index >= 0; index--) {
    if (working[index]?.type === 'assistant-message') {
      lastAssistantIndex = index
      break
    }
    if (working[index]?.type === 'user-message') break
  }
  if (lastAssistantIndex < 0) return working

  const leafAssistant = working[lastAssistantIndex]
  if (assistantHasBody(leafAssistant)) {
    if (leafAssistant.incomplete || isErrorStopReason(leafAssistant.stopReason)) {
      return working
    }
    return working
  }

  // Empty assistant with tools still following → not a true interrupted leaf
  if (isToolBridgeEmptyAssistant(working, lastAssistantIndex)) {
    return working
  }

  // Empty leaf assistant → mark incomplete (crash / force-quit / abort before tokens)
  void isTerminalStopReason(leafAssistant.stopReason)

  const next = working.slice() as T[]
  for (let index = lastAssistantIndex; index >= 0; index--) {
    const row = next[index]
    if (row.type === 'user-message') break
    if (row.type !== 'assistant-message') continue
    if (assistantHasBody(row)) break
    if (isToolBridgeEmptyAssistant(next, index)) continue
    next[index] = {
      ...row,
      incomplete: true,
      stopReason: isErrorStopReason(row.stopReason) ? row.stopReason : row.stopReason || 'interrupted',
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
  if (itemIndex >= 0 && isToolBridgeEmptyAssistant(items, itemIndex)) {
    return ownId
  }

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
  // Empty body alone is not interrupted — may be a tool-use bridge
  return false
}
