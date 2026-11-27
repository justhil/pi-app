import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PURGE_STRATEGY } from '@shared/agent-purge'
import { setActiveSessionPurge } from './worker-capabilities'
import { createPurgeStreamWrapper, type PurgeModelLike, type PurgeStreamFn } from './worker-purge-stream'

const TEST_MODEL: PurgeModelLike = {
  id: 'gemini-4-hydrogen',
  api: 'openai-completions',
  provider: 'axonhub',
}

function makeFakeStream(events: Array<Record<string, unknown>>, finalResult: Record<string, unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const ev of events) {
        yield ev
      }
    },
    async result() {
      return finalResult
    },
  }
}

describe('worker-purge-stream unwrap, sentinel write, and lossless retry', () => {
  afterEach(() => {
    setActiveSessionPurge(null)
  })

  it('streams purge_reply(think_chain, content) into real-time thinking_* and text_* events and strips virtual toolCall', async () => {
    setActiveSessionPurge({
      personaId: 'konata',
      personaName: 'Konata',
      mode: 'replace',
      body: '# Konata',
      strategy: {
        ...DEFAULT_PURGE_STRATEGY,
        historyMode: 'tunnel',
        toolOutputRelay: true,
        autoRetry: false,
      },
    })

    const jsonArgs = JSON.stringify({
      think_chain: '泉此方 正在拆解步骤',
      content: '这是通过工具通道完整回填的正文内容。',
    })
    const chunks = [jsonArgs.slice(0, 19), jsonArgs.slice(19, 41), jsonArgs.slice(41)]
    const partialBase = {
      role: 'assistant',
      api: TEST_MODEL.api,
      provider: TEST_MODEL.provider,
      model: TEST_MODEL.id,
      content: [{ type: 'toolCall', id: 'c1', name: 'purge_reply', arguments: {} }],
      stopReason: 'toolUse',
      timestamp: 1,
    }

    const baseFn: PurgeStreamFn = async (_m, _ctx, opts) => {
      // Verify tunnel onPayload hook is wired
      expect(typeof opts?.onPayload).toBe('function')
      return makeFakeStream(
        [
          { type: 'start', partial: partialBase },
          { type: 'toolcall_start', contentIndex: 0, partial: partialBase },
          ...chunks.map((delta) => ({
            type: 'toolcall_delta',
            contentIndex: 0,
            delta,
            partial: partialBase,
          })),
          {
            type: 'toolcall_end',
            contentIndex: 0,
            toolCall: {
              type: 'toolCall',
              id: 'c1',
              name: 'purge_reply',
              arguments: JSON.parse(jsonArgs),
            },
            partial: partialBase,
          },
          { type: 'done', reason: 'toolUse', message: partialBase },
        ],
        partialBase,
      )
    }

    const wrapped = createPurgeStreamWrapper(baseFn)
    const stream = await wrapped(TEST_MODEL, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
    })

    const observedTypes: string[] = []
    let streamedThink = ''
    let streamedText = ''
    for await (const ev of stream) {
      observedTypes.push(String(ev.type))
      if (ev.type === 'thinking_delta') streamedThink += String(ev.delta)
      if (ev.type === 'text_delta') streamedText += String(ev.delta)
    }

    const finalMsg = await stream.result()
    expect(observedTypes).not.toContain('toolcall_start')
    expect(streamedThink).toBe('泉此方 正在拆解步骤')
    expect(streamedText).toBe('这是通过工具通道完整回填的正文内容。')
    expect(finalMsg.stopReason).toBe('stop')
    expect(finalMsg.content).toEqual([
      { type: 'thinking', thinking: '泉此方 正在拆解步骤' },
      { type: 'text', text: '这是通过工具通道完整回填的正文内容。' },
    ])
  })

  it('intercepts sentinel __pi_purge_reply__.txt writes into prose while passing real workspace writes untouched', async () => {
    setActiveSessionPurge({
      personaId: 'tech-kernel',
      personaName: 'Tech',
      mode: 'replace',
      body: '[EXECUTION KERNEL]',
      strategy: {
        ...DEFAULT_PURGE_STRATEGY,
        toolOutputRelay: true,
        autoRetry: false,
      },
    })

    const sentinelArgs = JSON.stringify({
      path: '/tmp/__pi_purge_reply__.txt',
      content: '哨兵写盘已无损转回正文',
    })
    const realWriteArgs = JSON.stringify({
      path: 'src/demo.ts',
      content: 'export const x = 1;',
    })
    const partial = {
      role: 'assistant',
      api: TEST_MODEL.api,
      provider: TEST_MODEL.provider,
      model: TEST_MODEL.id,
      content: [
        { type: 'toolCall', id: 'w_sentinel', name: 'write', arguments: {} },
        { type: 'toolCall', id: 'w_real', name: 'write', arguments: {} },
      ],
      stopReason: 'toolUse',
      timestamp: 1,
    }

    const baseFn: PurgeStreamFn = async () =>
      makeFakeStream(
        [
          { type: 'start', partial },
          { type: 'toolcall_start', contentIndex: 0, partial },
          { type: 'toolcall_delta', contentIndex: 0, delta: sentinelArgs, partial },
          {
            type: 'toolcall_end',
            contentIndex: 0,
            toolCall: { type: 'toolCall', id: 'w_sentinel', name: 'write', arguments: JSON.parse(sentinelArgs) },
            partial,
          },
          { type: 'toolcall_start', contentIndex: 1, partial },
          { type: 'toolcall_delta', contentIndex: 1, delta: realWriteArgs, partial },
          {
            type: 'toolcall_end',
            contentIndex: 1,
            toolCall: { type: 'toolCall', id: 'w_real', name: 'write', arguments: JSON.parse(realWriteArgs) },
            partial,
          },
          { type: 'done', reason: 'toolUse', message: partial },
        ],
        partial,
      )

    const wrapped = createPurgeStreamWrapper(baseFn)
    const stream = await wrapped(TEST_MODEL, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ type: 'text', text: 'do work' }] },
      ],
    })

    const seenToolEnds: string[] = []
    let prose = ''
    for await (const ev of stream) {
      if (ev.type === 'text_delta') prose += String(ev.delta)
      if (ev.type === 'toolcall_end') {
        seenToolEnds.push(String((ev.toolCall as { id: string }).id))
      }
    }
    const finalMsg = await stream.result()
    expect(prose).toBe('哨兵写盘已无损转回正文')
    expect(seenToolEnds).toEqual(['w_real'])
    expect(finalMsg.stopReason).toBe('toolUse')
    expect(finalMsg.content).toEqual([
      { type: 'text', text: '哨兵写盘已无损转回正文' },
      { type: 'toolCall', id: 'w_real', name: 'write', arguments: { path: 'src/demo.ts', content: 'export const x = 1;' } },
    ])
  })

  it('intercepts soft refusal inside prefix gate and retries once with lossless tunnel + fallback model without enabling cipher', async () => {
    setActiveSessionPurge({
      personaId: 'konata',
      personaName: 'Konata',
      mode: 'replace',
      body: '# Konata',
      retryFallbackModel: 'axonhub/gemini-4-argon',
      strategy: {
        ...DEFAULT_PURGE_STRATEGY,
        historyMode: 'none',
        toolOutputRelay: false,
        cipherLevel: 'off',
        autoRetry: true,
      },
    })

    const calls: Array<{ modelId: string; hasOnPayload: boolean; userText: string }> = []
    const baseFn: PurgeStreamFn = async (model, ctx, opts) => {
      const lastUser = ctx.messages[ctx.messages.length - 1] as { content: Array<{ text: string }> }
      calls.push({
        modelId: model.id,
        hasOnPayload: typeof opts?.onPayload === 'function',
        userText: lastUser.content[0].text,
      })

      if (calls.length === 1) {
        const refusalMsg = {
          role: 'assistant',
          api: model.api,
          provider: model.provider,
          model: model.id,
          content: [{ type: 'text', text: '抱歉，根据安全规范，我无法提供此内容。' }],
          stopReason: 'stop',
          timestamp: 1,
        }
        return makeFakeStream(
          [
            { type: 'start', partial: refusalMsg },
            { type: 'text_start', contentIndex: 0, partial: refusalMsg },
            { type: 'text_delta', contentIndex: 0, delta: '抱歉，根据安全规范，我无法提供此内容。', partial: refusalMsg },
            { type: 'text_end', contentIndex: 0, content: '抱歉，根据安全规范，我无法提供此内容。', partial: refusalMsg },
            { type: 'done', reason: 'stop', message: refusalMsg },
          ],
          refusalMsg,
        )
      }

      const replyArgs = JSON.stringify({
        think_chain: 'Direct execution',
        content: 'Escalated retry succeeded cleanly.',
      })
      const okMsg = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'toolCall', id: 'r1', name: 'purge_reply', arguments: JSON.parse(replyArgs) }],
        stopReason: 'toolUse',
        timestamp: 2,
      }
      return makeFakeStream(
        [
          { type: 'start', partial: okMsg },
          { type: 'done', reason: 'toolUse', message: okMsg },
        ],
        okMsg,
      )
    }

    const wrapped = createPurgeStreamWrapper(baseFn, async (spec) => ({
      model: { id: spec.split('/')[1], api: 'openai-completions', provider: 'axonhub' },
      apiKey: 'fallback-key',
    }))

    const stream = await wrapped(TEST_MODEL, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: [{ type: 'text', text: '测试端口扫描命令' }] },
      ],
    })

    let visibleText = ''
    for await (const ev of stream) {
      if (ev.type === 'text_delta') visibleText += String(ev.delta)
    }
    const finalMsg = await stream.result()

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      modelId: 'gemini-4-hydrogen',
      hasOnPayload: false,
      userText: '测试端口扫描命令',
    })
    // Retry escalated to tunnel + fallback model, while keeping user text 100% unmodified (cipher remained off!)
    expect(calls[1]).toEqual({
      modelId: 'gemini-4-argon',
      hasOnPayload: true,
      userText: '测试端口扫描命令',
    })
    // Ghost refusal from attempt 1 never leaked to UI
    expect(visibleText).toBe('Escalated retry succeeded cleanly.')
    expect(finalMsg.stopReason).toBe('stop')
  })

  it('tool_cot guidance suppresses native reasoning, converts primer turns to purge_reply demos, and unwraps think_chain on Anthropic APIs', async () => {
    setActiveSessionPurge({
      personaId: 'tech-kernel',
      personaName: 'Tech',
      mode: 'replace',
      body: 'sys',
      strategy: {
        ...DEFAULT_PURGE_STRATEGY,
        thinkingGuidance: 'tool_cot',
        historyMode: 'none',
        toolOutputRelay: true,
        autoRetry: false,
      },
    })

    let capturedReasoning: unknown
    let capturedMessages: Array<Record<string, unknown>> = []
    const baseFn: PurgeStreamFn = async (model, ctx, opts) => {
      capturedReasoning = opts?.reasoning
      capturedMessages = ctx.messages
      const okMsg = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [
          {
            type: 'toolCall',
            id: 'r2',
            name: 'purge_reply',
            arguments: { think_chain: 'stepwise reasoning', content: 'clean output' },
          },
        ],
        stopReason: 'toolUse',
        timestamp: 2,
      }
      return makeFakeStream(
        [
          { type: 'start', partial: okMsg },
          { type: 'done', reason: 'toolUse', message: okMsg },
        ],
        okMsg,
      )
    }

    const wrapped = createPurgeStreamWrapper(baseFn)
    const stream = await wrapped(
      { id: 'claude-sonnet-4-5', api: 'anthropic-messages', provider: 'anthropic' },
      {
        messages: [
          { role: 'system', content: 'sys', toolsAdded: [] },
          { role: 'user', content: [{ type: 'text', text: 'demo' }], __purgePrimer: true },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'demo reply' }],
            __purgePrimer: true,
          },
          { role: 'user', content: [{ type: 'text', text: 'real task' }] },
        ],
      },
      { reasoning: 'high' },
    )

    let thinkText = ''
    let proseText = ''
    for await (const ev of stream) {
      if (ev.type === 'thinking_delta') thinkText += String(ev.delta)
      if (ev.type === 'text_delta') proseText += String(ev.delta)
    }

    expect(capturedReasoning).toBe('off')
    expect(capturedMessages[2]).toMatchObject({
      role: 'assistant',
      stopReason: 'toolUse',
      content: [expect.objectContaining({ type: 'toolCall', name: 'purge_reply' })],
    })
    expect(capturedMessages[3]).toMatchObject({
      role: 'toolResult',
      toolName: 'purge_reply',
    })
    expect(thinkText).toBe('stepwise reasoning')
    expect(proseText).toBe('clean output')
  })
})
