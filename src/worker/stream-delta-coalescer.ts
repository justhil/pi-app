import type { AppEvent } from '@shared/app-events'

/**
 * Coalesce assistant stream deltas before they cross Worker → Main → Renderer IPC (idea from
 * vastsa/pi-desktop D412). A fast model emits one delta per token; each became its own
 * postMessage, a Main enrich/observe pass and a webContents.send. Deltas of the same stream are
 * concatenated for up to one frame and flushed before any other event, so ordering against
 * tool / message-end / run events is unchanged.
 */
export const STREAM_COALESCE_MS = 16

type DeltaEvent = Extract<AppEvent, { type: 'message' }> & { phase: 'delta'; text: string }

function isStreamDelta(event: AppEvent): event is DeltaEvent {
  return (
    event.type === 'message' &&
    event.role === 'assistant' &&
    event.phase === 'delta' &&
    typeof event.text === 'string'
  )
}

function sameStream(a: DeltaEvent, b: DeltaEvent): boolean {
  return (
    (a.contentKind ?? 'text') === (b.contentKind ?? 'text') &&
    a.sessionFile === b.sessionFile &&
    a.sessionId === b.sessionId &&
    a.runId === b.runId &&
    a.turnId === b.turnId
  )
}

export function createStreamDeltaCoalescer(
  send: (event: AppEvent) => void,
  timers: {
    set: (callback: () => void, ms: number) => unknown
    clear: (handle: unknown) => void
  } = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): { emit: (event: AppEvent) => void; flush: () => void } {
  let pending: DeltaEvent | null = null
  let timer: unknown = null

  const flush = (): void => {
    if (timer !== null) {
      timers.clear(timer)
      timer = null
    }
    if (!pending) return
    const event = pending
    pending = null
    send(event)
  }

  const emit = (event: AppEvent): void => {
    if (!isStreamDelta(event)) {
      flush()
      send(event)
      return
    }
    if (pending && sameStream(pending, event)) {
      pending = { ...pending, text: pending.text + event.text, timestamp: event.timestamp }
      return
    }
    flush()
    pending = event
    timer = timers.set(flush, STREAM_COALESCE_MS)
  }

  return { emit, flush }
}
