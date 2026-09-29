import { describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { createStreamDeltaCoalescer, STREAM_COALESCE_MS } from './stream-delta-coalescer'

const base = { workspaceId: '/w', sessionFile: '/s.jsonl', sessionId: 's', runId: 'r', turnId: 't' }
let seq = 0
const delta = (text: string, contentKind: 'text' | 'thinking' = 'text'): AppEvent =>
  ({ ...base, seq: ++seq, timestamp: seq, type: 'message', role: 'assistant', phase: 'delta', text, contentKind }) as AppEvent
const tool = (): AppEvent =>
  ({ ...base, seq: ++seq, timestamp: seq, type: 'tool', toolCallId: 'c', toolName: 'bash', phase: 'start' }) as AppEvent

describe('stream delta coalescer', () => {
  it('sends one delta per frame instead of one per token', () => {
    vi.useFakeTimers()
    try {
      const sent: AppEvent[] = []
      const { emit } = createStreamDeltaCoalescer((event) => sent.push(event))
      for (const token of ['He', 'll', 'o ', 'wor', 'ld']) emit(delta(token))
      expect(sent).toHaveLength(0)

      vi.advanceTimersByTime(STREAM_COALESCE_MS)

      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({ type: 'message', phase: 'delta', text: 'Hello world' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending text before any other event so ordering is unchanged', () => {
    const sent: AppEvent[] = []
    const { emit } = createStreamDeltaCoalescer((event) => sent.push(event))

    emit(delta('before '))
    emit(delta('tool'))
    emit(tool())
    emit(delta('after'))

    expect(sent.map((event) => (event.type === 'message' ? `delta:${event.text}` : event.type))).toEqual([
      'delta:before tool',
      'tool',
    ])
  })

  it('never merges text with thinking or across runs', () => {
    const sent: AppEvent[] = []
    const { emit, flush } = createStreamDeltaCoalescer((event) => sent.push(event))

    emit(delta('think', 'thinking'))
    emit(delta('say'))
    emit({ ...(delta('other run') as object), runId: 'r2' } as AppEvent)
    flush()

    expect(sent.map((event) => (event as { text?: string }).text)).toEqual(['think', 'say', 'other run'])
  })
})
