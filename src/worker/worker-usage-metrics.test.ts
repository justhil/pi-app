import { describe, expect, it } from 'vitest'
import { createUsageMetricsExtension } from './worker-usage-metrics'

type Handler = (event: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<unknown> | unknown

function createHarness(clockValues: number[]) {
  let idx = 0
  const now = () => clockValues[Math.min(idx++, clockValues.length - 1)]
  const handlers = new Map<string, Handler[]>()
  const ext = createUsageMetricsExtension({ nowMono: now, nowWall: () => 1_700_000_000_000 + now() })
  ext.factory({
    on: (event: string, fn: Handler) => {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
    },
  } as never)

  const emit = async (type: string, payload: Record<string, unknown>) => {
    for (const fn of handlers.get(type) ?? []) {
      await fn({ type, ...payload }, {})
    }
  }
  return { emit }
}

describe('worker-usage-metrics extension', () => {
  it('should_stamp_ttftMs_and_firstTokenKind_thinking_before_session_persistence', async () => {
    // 100ms: user message_end (request about to start)
    // 460ms: first thinking_delta -> ttft = 460 - 100 = 360ms
    // 900ms: later text_delta (ignored because first token already recorded)
    const { emit } = createHarness([100, 460, 900])

    await emit('message_end', { message: { role: 'user', content: 'hi' } })
    await emit('message_start', {
      message: { role: 'assistant', content: [], timestamp: 1_700_000_000_105 },
    })
    await emit('message_update', {
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'thinking_delta', delta: 'let me think' },
    })
    await emit('message_update', {
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
    })

    const finalAssistant: Record<string, unknown> = {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      durationMs: 1200,
    }
    await emit('message_end', { message: finalAssistant })

    expect(finalAssistant.ttftMs).toBe(360)
    expect(finalAssistant.firstTokenKind).toBe('thinking')
  })

  it('should_distinguish_non_streamed_thinking_when_first_delta_is_text_and_clamp_to_durationMs', async () => {
    const { emit } = createHarness([50, 850])

    await emit('turn_start', { turnIndex: 0 })
    await emit('message_start', {
      message: { role: 'assistant', content: [], timestamp: 1_700_000_000_050 },
    })
    await emit('message_update', {
      message: { role: 'assistant', content: [] },
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    })

    const finalAssistant: Record<string, unknown> = {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      durationMs: 700,
    }
    await emit('message_end', { message: finalAssistant })

    expect(finalAssistant.ttftMs).toBe(700)
    expect(finalAssistant.firstTokenKind).toBe('text')
  })

  it('should_leave_ttftMs_undefined_when_request_fails_without_any_token_delta', async () => {
    const { emit } = createHarness([10, 20])

    await emit('message_start', {
      message: { role: 'assistant', content: [] },
    })
    const failedAssistant: Record<string, unknown> = {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '429 rate limit',
      content: [],
    }
    await emit('message_end', { message: failedAssistant })

    expect(failedAssistant.ttftMs).toBeUndefined()
    expect(failedAssistant.firstTokenKind).toBeUndefined()
  })
})
