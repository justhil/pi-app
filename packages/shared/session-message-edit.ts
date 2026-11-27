export type EditableMessageRole = 'user' | 'assistant'

export type SessionMessageEditError =
  | 'empty_text'
  | 'entry_not_found'
  | 'not_editable_message'
  | 'invalid_jsonl'

export type SessionEntryEditResult =
  | {
      ok: true
      role: EditableMessageRole
      entry: Record<string, unknown>
    }
  | {
      ok: false
      error: SessionMessageEditError
    }

export type SessionJsonlEditResult =
  | {
      ok: true
      role: EditableMessageRole
      jsonl: string
    }
  | {
      ok: false
      error: SessionMessageEditError
    }

const RECOVERABLE_STOP_REASONS = new Set(['error', 'aborted', 'interrupted', 'pending'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Rewrite a single Pi session `message` entry (`user` or `assistant`) in place while preserving:
 * - entry `id`, `parentId`, `timestamp` (keeps session tree pointers, forks, and rewinds intact)
 * - user `image` content blocks
 * - assistant `toolCall` content blocks (prevents orphaned subsequent `toolResult` messages)
 *
 * For assistant edits:
 * - strips stale `thinking` blocks and `textSignature` so forged text never conflicts with
 *   prior refusal CoT or provider item/thought signatures
 * - promotes failed/aborted `stopReason` (`error` / `aborted` / `interrupted`) to `'stop'`
 *   (or `'toolUse'` when `toolCall` blocks remain) and clears `errorMessage` so `@earendil-works/pi-ai`
 *   `transformMessages` includes the forged reply in subsequent LLM requests.
 */
export function applySessionMessageEditToEntry(
  rawEntry: unknown,
  nextText: string,
): SessionEntryEditResult {
  if (typeof nextText !== 'string' || nextText.trim().length === 0) {
    return { ok: false, error: 'empty_text' }
  }
  if (!isRecord(rawEntry) || rawEntry.type !== 'message' || !isRecord(rawEntry.message)) {
    return { ok: false, error: 'not_editable_message' }
  }

  const msg = rawEntry.message
  const role = msg.role
  if (role !== 'user' && role !== 'assistant') {
    return { ok: false, error: 'not_editable_message' }
  }

  if (role === 'user') {
    const rawContent = msg.content
    const nextBlock = { type: 'text', text: nextText }
    let nextContent: unknown[]
    if (Array.isArray(rawContent)) {
      nextContent = []
      let insertedText = false
      for (const block of rawContent) {
        if (isRecord(block) && block.type === 'text') {
          if (!insertedText) {
            nextContent.push(nextBlock)
            insertedText = true
          }
          continue
        }
        nextContent.push(block)
      }
      if (!insertedText) nextContent.unshift(nextBlock)
    } else {
      nextContent = [nextBlock]
    }

    return {
      ok: true,
      role: 'user',
      entry: {
        ...rawEntry,
        message: {
          ...msg,
          content: nextContent,
        },
      },
    }
  }

  const rawContent = Array.isArray(msg.content) ? msg.content : []
  const toolCalls = rawContent.filter((block) => isRecord(block) && block.type === 'toolCall')
  const nextContent: unknown[] = [{ type: 'text', text: nextText }, ...toolCalls]

  const prevStop = typeof msg.stopReason === 'string' ? msg.stopReason : ''
  const nextStopReason =
    !prevStop || RECOVERABLE_STOP_REASONS.has(prevStop)
      ? toolCalls.length > 0
        ? 'toolUse'
        : 'stop'
      : prevStop

  const nextMessage: Record<string, unknown> = {
    ...msg,
    content: nextContent,
    stopReason: nextStopReason,
  }
  delete nextMessage.errorMessage

  return {
    ok: true,
    role: 'assistant',
    entry: {
      ...rawEntry,
      message: nextMessage,
    },
  }
}

export function rewriteSessionJsonlMessage(
  rawJsonl: string,
  entryId: string,
  nextText: string,
): SessionJsonlEditResult {
  if (typeof nextText !== 'string' || nextText.trim().length === 0) {
    return { ok: false, error: 'empty_text' }
  }
  const targetId = typeof entryId === 'string' ? entryId.trim() : ''
  if (!targetId) {
    return { ok: false, error: 'entry_not_found' }
  }
  if (typeof rawJsonl !== 'string' || rawJsonl.trim().length === 0) {
    return { ok: false, error: 'entry_not_found' }
  }

  const eol = rawJsonl.includes('\r\n') ? '\r\n' : '\n'
  const lines = rawJsonl.split(/\r?\n/)
  let matchedRole: EditableMessageRole | null = null
  let sawValidEntry = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return { ok: false, error: 'invalid_jsonl' }
    }
    if (isRecord(parsed)) sawValidEntry = true
    if (isRecord(parsed) && parsed.id === targetId) {
      const applied = applySessionMessageEditToEntry(parsed, nextText)
      if (!applied.ok) return applied
      lines[i] = JSON.stringify(applied.entry)
      matchedRole = applied.role
      break
    }
  }

  if (!sawValidEntry) {
    return { ok: false, error: 'invalid_jsonl' }
  }
  if (!matchedRole) {
    return { ok: false, error: 'entry_not_found' }
  }

  return {
    ok: true,
    role: matchedRole,
    jsonl: lines.join(eol),
  }
}
