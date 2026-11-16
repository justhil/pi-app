import {
  extractTextFromPiMessage,
  extractThinkingFromPiMessage,
  extractToolResultFromPiMessage,
  normalizeUserMessageDisplayText,
  piMessageTimestamp,
  type PiSessionMessage,
} from '@shared/worker-message'
import { markTrailingIncompleteAssistants } from '@shared/timeline-incomplete'
import {
  extractCodemodeArgField,
  mergeCodemodeNestedCalls,
  parseCodemodeCalls,
} from '@shared/tool-call-detail'

let msgSeq = 0
/**
 * History rows are built in Main *and* in every Worker process, each with its own counter (and a
 * restarted Worker starts over). Timelines merge rows from several of those sources, so bare
 * `hist-N` ids collided; duplicate React keys then misplaced whole turns / tool rows until a
 * remount. A per-process tag keeps ids unique across sources.
 */
const PROCESS_TAG = Math.random().toString(36).slice(2, 7)

function nextHistId(): string {
  return `hist-${PROCESS_TAG}-${++msgSeq}`
}

export function resetTimelineSeq(): void {
  msgSeq = 0
}

const extractText = extractTextFromPiMessage
const extractThinking = extractThinkingFromPiMessage
const extractToolResult = extractToolResultFromPiMessage

/** Always keep assistant rows (even empty) so incomplete turns remain rewound-able. */
function pushAssistantItem(
  items: Array<Record<string, unknown>>,
  opts: {
    text: string
    thinkingText: string
    timestamp: number
    sessionEntryId?: string
    stopReason?: string
    /** Provider error of a failed reply (e.g. "Request timed out."), shown instead of a bare "incomplete". */
    errorMessage?: string
    /** Same assistant message also emitted toolCall blocks — not a crash leaf. */
    hasToolCalls?: boolean
  },
): void {
  const emptyBody = !opts.text.trim() && !opts.thinkingText.trim()
  const errorStop =
    opts.stopReason === 'aborted' || opts.stopReason === 'error' || opts.stopReason === 'interrupted'
  // Mid-turn tool-use bridges are empty by design — only mark incomplete on true errors
  // or empty leaves without tool calls (crash before first token / tool).
  const incomplete = emptyBody && (errorStop || !opts.hasToolCalls)
  items.push({
    id: nextHistId(),
    type: 'assistant-message',
    text: opts.text,
    thinkingText: opts.thinkingText || undefined,
    timestamp: opts.timestamp,
    ...(opts.sessionEntryId ? { sessionEntryId: opts.sessionEntryId } : {}),
    ...(incomplete
      ? {
          incomplete: true,
          stopReason: opts.stopReason || 'interrupted',
          ...(opts.stopReason === 'error' && opts.errorMessage?.trim() ? { errorMessage: opts.errorMessage.trim() } : {}),
        }
      : opts.stopReason
        ? { stopReason: opts.stopReason }
        : {}),
  })
}

export function normalizeMessages(messages: unknown[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []
  const now = Date.now()
  const toolCallIndex = new Map<string, number>()

  for (const m of messages) {
    const pm = m as PiSessionMessage & { toolCallId?: string; toolName?: string }
    const ts = piMessageTimestamp(pm, now)
    const content = Array.isArray(pm.content) ? pm.content : []

    if (pm.role === 'user') {
      const text = normalizeUserMessageDisplayText(extractText(pm))
      if (text) items.push({ id: nextHistId(), type: 'user-message', text, timestamp: ts })
    } else if (pm.role === 'assistant') {
      const text = extractText(pm)
      const thinkingText = extractThinking(pm)
      const toolCalls = content.filter((c) => (c as { type?: string }).type === 'toolCall')
      // Always emit assistant bubble (even if empty after crash mid-stream) for leaf/rewind.
      pushAssistantItem(items, {
        text,
        thinkingText,
        timestamp: ts,
        stopReason: pm.stopReason,
        errorMessage: (pm as { errorMessage?: string }).errorMessage,
        hasToolCalls: toolCalls.length > 0,
      })
      for (const c of toolCalls) {
        const tc = c as {
          name?: string
          input?: unknown
          arguments?: unknown
          id?: string
          toolCall?: { name?: string; input?: unknown; arguments?: unknown; id?: string }
        }
        const name = tc.name || tc.toolCall?.name || 'tool'
        const input = tc.input ?? tc.arguments ?? tc.toolCall?.input ?? tc.toolCall?.arguments
        const callId = tc.id || tc.toolCall?.id || ''
        const item: Record<string, unknown> = {
          id: nextHistId(),
          type: 'tool-call',
          ...(callId ? { toolCallId: callId } : {}),
          toolName: name,
          toolArgs: input || undefined,
          toolPhase: 'end',
          toolOutput: '',
          timestamp: ts,
        }
        const idx = items.length
        items.push(item)
        if (callId) toolCallIndex.set(callId, idx)
      }
    } else if (pm.role === 'toolResult') {
      const text = extractText(pm) || extractToolResult(pm)
      const callId = pm.toolCallId || ''
      const toolName = pm.toolName || ''
      let targetIdx = callId ? toolCallIndex.get(callId) : undefined
      if (targetIdx === undefined) {
        for (let i = items.length - 1; i >= 0; i--) {
          const row = items[i]
          if (
            row.type === 'tool-call' &&
            !row.toolOutput &&
            (!toolName || row.toolName === toolName)
          ) {
            targetIdx = i
            break
          }
        }
      }
      const mergedDetails = mergeCodemodeNestedCalls(
        pm.details,
        (pm as { nestedCalls?: unknown }).nestedCalls,
      )
      if (targetIdx !== undefined && items[targetIdx]) {
        items[targetIdx].toolOutput = text.slice(0, 4000)
        if (callId) items[targetIdx].toolCallId = callId
        if (mergedDetails !== undefined) items[targetIdx].toolDetails = mergedDetails
        if (pm.isError !== undefined) items[targetIdx].isError = pm.isError
        if (toolName && items[targetIdx].toolName === 'tool') items[targetIdx].toolName = toolName
      } else if (text) {
        items.push({
          id: nextHistId(),
          type: 'tool-call',
          ...(callId ? { toolCallId: callId } : {}),
          toolName: toolName || 'result',
          toolPhase: 'end',
          toolOutput: text.slice(0, 2000),
          ...(mergedDetails !== undefined ? { toolDetails: mergedDetails } : {}),
          ...(pm.isError !== undefined ? { isError: pm.isError } : {}),
          timestamp: ts,
        })
      }
    } else if (pm.role === 'compactionSummary' || pm.role === 'branchSummary') {
      const text = extractText(pm)
      items.push({ id: nextHistId(), type: 'compaction', text, timestamp: ts })
    }
  }
  return markTrailingIncompleteAssistants(items)
}

/** 按当前 leaf 的 getBranch() 顺序建时间线，与 TUI 树上路径一致。 */
export function timelineItemsFromBranchPath(path: unknown[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []
  const toolCallIndex = new Map<string, number>()
  const now = Date.now()

  for (const entry of path) {
    const e = entry as {
      timestamp?: string
      id?: string
      type?: string
      summary?: string
      message?: PiSessionMessage & { content?: unknown[] }
    }
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : now
    const sid = e.id

    if (e.type === 'compaction' && e.summary) {
      items.push({
        id: nextHistId(),
        type: 'compaction',
        text: String(e.summary),
        timestamp: ts,
        sessionEntryId: sid,
      })
      continue
    }
    if (e.type === 'branch_summary' && e.summary) {
      items.push({
        id: nextHistId(),
        type: 'compaction',
        text: String(e.summary),
        timestamp: ts,
        sessionEntryId: sid,
      })
      continue
    }
    if (e.type !== 'message' || !e.message) continue

    const m = e.message
    const content = m.content || []

    if (m.role === 'user') {
      const text = normalizeUserMessageDisplayText(extractText(m))
      // Keep empty user only if we have an entry id (rare); normally require text.
      if (text || sid) {
        items.push({
          id: nextHistId(),
          type: 'user-message',
          text: text || '',
          timestamp: ts,
          sessionEntryId: sid,
        })
      }
    } else if (m.role === 'assistant') {
      const text = extractText(m)
      const thinkingText = extractThinking(m)
      const toolCalls = content.filter((c) => (c as { type?: string }).type === 'toolCall')
      // Always keep assistant entries — crash mid-turn leaves empty leaf that must stay visible for rewind.
      pushAssistantItem(items, {
        text,
        thinkingText,
        timestamp: ts,
        sessionEntryId: sid,
        stopReason: m.stopReason,
        errorMessage: (m as { errorMessage?: string }).errorMessage,
        hasToolCalls: toolCalls.length > 0,
      })
      for (const c of toolCalls) {
        const cc = c as {
          name?: string
          arguments?: unknown
          id?: string
          toolCall?: { name?: string; input?: unknown; arguments?: unknown; id?: string }
        }
        const name = cc.name || cc.toolCall?.name || 'tool'
        const input = cc.arguments ?? cc.toolCall?.input ?? cc.toolCall?.arguments
        const callId = cc.id || cc.toolCall?.id || ''
        const item: Record<string, unknown> = {
          id: nextHistId(),
          type: 'tool-call',
          ...(callId ? { toolCallId: callId } : {}),
          toolName: name,
          toolArgs: input || undefined,
          toolPhase: 'end',
          toolOutput: '',
          timestamp: ts,
          sessionEntryId: sid,
        }
        const idx = items.length
        items.push(item)
        if (callId) toolCallIndex.set(callId, idx)
      }
    } else if (m.role === 'toolResult') {
      const text = extractText(m)
      const callId = (m as { toolCallId?: string }).toolCallId || ''
      const toolName = (m as { toolName?: string }).toolName || ''
      let targetIdx = callId ? toolCallIndex.get(callId) : undefined
      if (targetIdx === undefined) {
        for (let i = items.length - 1; i >= 0; i--) {
          const row = items[i]
          if (
            row.type === 'tool-call' &&
            !row.toolOutput &&
            (!toolName || row.toolName === toolName)
          ) {
            targetIdx = i
            break
          }
        }
      }
      const mergedDetails = mergeCodemodeNestedCalls(
        m.details,
        (m as { nestedCalls?: unknown }).nestedCalls,
      )
      if (targetIdx !== undefined && items[targetIdx]) {
        items[targetIdx].toolOutput = text.slice(0, 4000)
        if (callId) items[targetIdx].toolCallId = callId
        if (mergedDetails !== undefined) items[targetIdx].toolDetails = mergedDetails
        if (m.isError !== undefined) items[targetIdx].isError = m.isError
        if (toolName && items[targetIdx].toolName === 'tool') items[targetIdx].toolName = toolName
      } else if (text) {
        items.push({
          id: nextHistId(),
          type: 'tool-call',
          ...(callId ? { toolCallId: callId } : {}),
          toolName: toolName || 'result',
          toolPhase: 'end',
          toolOutput: text.slice(0, 2000),
          ...(mergedDetails !== undefined ? { toolDetails: mergedDetails } : {}),
          ...(m.isError !== undefined ? { isError: m.isError } : {}),
          timestamp: ts,
          sessionEntryId: sid,
        })
      }
    }
  }
  // Force-quit mid-stream leaves empty assistant leaf — mark so UI keeps it + rewind works.
  return markTrailingIncompleteAssistants(items)
}

export type BranchTouchedFile = {
  path: string
  source: 'edit' | 'write'
  changeType: 'created' | 'modified'
}

/**
 * Scan the entire active branch path from root to leaf for successful mutate tool calls
 * (`edit`, `write`, `insert`, or `codemode` nested edits/writes), so Review's "This session"
 * scope stays accurate even when a session exceeds the initial 80-message timeline page.
 */
export function extractBranchTouchedFiles(path: unknown[]): BranchTouchedFile[] {
  const pendingCalls = new Map<string, { name: string; args?: Record<string, unknown> }>()
  const byKey = new Map<string, BranchTouchedFile>()

  const record = (rawPath: string | undefined, toolName: string): void => {
    const trimmed = typeof rawPath === 'string' ? rawPath.trim() : ''
    if (!trimmed) return
    const key = trimmed.replace(/\\/g, '/').toLowerCase()
    const source: 'edit' | 'write' = toolName === 'write' ? 'write' : 'edit'
    const changeType: 'created' | 'modified' = toolName === 'write' ? 'created' : 'modified'
    if (!byKey.has(key)) {
      byKey.set(key, { path: trimmed, source, changeType })
    }
  }

  for (const raw of path) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as { type?: string; message?: PiSessionMessage & { nestedCalls?: unknown } }
    if (e.type !== 'message' || !e.message) continue
    const m = e.message

    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const rawBlock of m.content) {
        const block = rawBlock as {
          type?: string
          id?: string
          name?: string
          arguments?: unknown
          toolCall?: { id?: string; name?: string; input?: unknown; arguments?: unknown }
        }
        if (block.type !== 'toolCall') continue
        const callId = block.id || block.toolCall?.id || ''
        const name = block.name || block.toolCall?.name || ''
        const rawArgs = block.arguments ?? block.toolCall?.input ?? block.toolCall?.arguments
        const args =
          rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : undefined
        if (callId && name) {
          pendingCalls.set(callId, { name, args })
        }
      }
      continue
    }

    if (m.role === 'toolResult') {
      const mTool = m as { toolCallId?: string; toolUseId?: string; toolName?: string }
      const callId = mTool.toolCallId || mTool.toolUseId || ''
      const started = callId ? pendingCalls.get(callId) : undefined
      if (callId) pendingCalls.delete(callId)
      if (m.isError) continue
      const toolName = (started?.name || mTool.toolName || '').toLowerCase()
      if (toolName === 'edit' || toolName === 'write' || toolName === 'insert') {
        const args = started?.args
        const rawPath =
          typeof args?.path === 'string'
            ? args.path
            : typeof args?.file_path === 'string'
              ? args.file_path
              : typeof args?.filePath === 'string'
                ? args.filePath
                : undefined
        record(rawPath, toolName)
      } else if (toolName === 'codemode') {
        const mergedDetails = mergeCodemodeNestedCalls(m.details, m.nestedCalls)
        const code = typeof started?.args?.code === 'string' ? started.args.code : undefined
        for (const call of parseCodemodeCalls(mergedDetails, code)) {
          if (call.status === 'error' || call.status === 'cancelled') continue
          const nestedName = call.name.toLowerCase()
          if (nestedName !== 'edit' && nestedName !== 'write' && nestedName !== 'insert') continue
          const filePath =
            call.path ??
            extractCodemodeArgField(call.args, 'path') ??
            extractCodemodeArgField(call.args, 'file_path')
          record(filePath, nestedName)
        }
      }
    }
  }

  return [...byKey.values()]
}
