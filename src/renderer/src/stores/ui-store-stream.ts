import { mergeStreamChunk } from '@shared/stream-merge'
import type { TimelineItem } from '@renderer/stores/ui-store-types'

export { mergeStreamChunk } from '@shared/stream-merge'

type StreamFlushKind = 'text' | 'thinking'

let streamFlushScheduled = false
const streamPending = new Map<string, { text: string; thinking: string }>()

type StreamStore = {
  streamingAssistantId: string | null
  timelineItems: TimelineItem[]
}

export function flushStreamPendingSync<S extends StreamStore>(
  get: () => S,
  set: (fn: (s: S) => Partial<S> | S) => void,
): void {
  streamFlushScheduled = false
  const sid = get().streamingAssistantId
  if (!sid) {
    streamPending.clear()
    return
  }
  const pending = streamPending.get(sid)
  if (!pending || (!pending.text && !pending.thinking)) return
  const textDelta = pending.text
  const thinkDelta = pending.thinking
  pending.text = ''
  pending.thinking = ''
  set((s) => {
    if (s.streamingAssistantId !== sid) return s
    const index = s.timelineItems.findIndex((row) => row.id === sid)
    if (index < 0) return s
    const current = s.timelineItems[index]
    let nextText = current.text || ''
    let nextThinking = current.thinkingText || ''
    let changed = false
    if (textDelta) {
      const merged = mergeStreamChunk(nextText, textDelta)
      if (merged !== nextText) {
        nextText = merged
        changed = true
      }
    }
    if (thinkDelta) {
      const merged = mergeStreamChunk(nextThinking, thinkDelta)
      if (merged !== nextThinking) {
        nextThinking = merged
        changed = true
      }
    }
    if (!changed) return s
    // Copy once and patch the streaming row — avoid dual full-array maps per flush.
    const items = s.timelineItems.slice()
    items[index] = { ...current, text: nextText, thinkingText: nextThinking }
    return { timelineItems: items } as Partial<S>
  })
}

function scheduleStreamFlush<S extends StreamStore>(
  get: () => S,
  set: (fn: (s: S) => Partial<S> | S) => void,
): void {
  if (streamFlushScheduled) return
  streamFlushScheduled = true
  requestAnimationFrame(() => flushStreamPendingSync(get, set))
}

export function queueStreamDelta<S extends StreamStore>(
  get: () => S,
  set: (fn: (s: S) => Partial<S> | S) => void,
  kind: StreamFlushKind,
  delta: string,
): void {
  const sid = get().streamingAssistantId
  if (!sid || !delta) return
  let row = streamPending.get(sid)
  if (!row) {
    row = { text: '', thinking: '' }
    streamPending.set(sid, row)
  }
  if (kind === 'text') row.text = mergeStreamChunk(row.text, delta)
  else row.thinking = mergeStreamChunk(row.thinking, delta)
  scheduleStreamFlush(get, set)
}

export function clearStreamPending(): void {
  streamPending.clear()
  streamFlushScheduled = false
}

export function deleteStreamPendingForId(id: string): void {
  streamPending.delete(id)
}