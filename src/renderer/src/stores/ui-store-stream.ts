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
    let items = s.timelineItems
    let changed = false
    if (textDelta) {
      items = items.map((i) => {
        if (i.id !== sid) return i
        const next = mergeStreamChunk(i.text || '', textDelta)
        if (next === i.text) return i
        changed = true
        return { ...i, text: next }
      })
    }
    if (thinkDelta) {
      items = items.map((i) => {
        if (i.id !== sid) return i
        const next = mergeStreamChunk(i.thinkingText || '', thinkDelta)
        if (next === i.thinkingText) return i
        changed = true
        return { ...i, thinkingText: next }
      })
    }
    if (!changed) return s
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