import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handleGetmodels,
  handleGetsessioncontextpreview,
  handleReloadmodels,
} from './worker-handlers-catalog'
import { st, type WorkerModelRuntime } from '../worker-runtime'

function modelRuntimeWith(options?: {
  models?: Array<{ provider: string; id: string; name?: string }>
  refresh?: () => Promise<unknown>
}): WorkerModelRuntime {
  return {
    getModel: vi.fn(),
    getAvailable: vi.fn(async () => options?.models ?? []),
    refresh: vi.fn(options?.refresh ?? (async () => ({ providers: [] }))),
  } as unknown as WorkerModelRuntime
}

afterEach(() => {
  st.modelRuntime = null
  st.session = null
  st.currentSessionId = ''
})

describe('worker model catalog handlers', () => {
  it('rejects reload when ModelRuntime is not ready', async () => {
    const reply = vi.fn()

    await handleReloadmodels({}, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'MODEL_RUNTIME_NOT_READY' })
  })

  it('reloads and lists models through the shared ModelRuntime', async () => {
    const runtime = modelRuntimeWith({ models: [{ provider: 'openai', id: 'gpt/new', name: 'GPT New' }] })
    st.modelRuntime = runtime
    const reloadReply = vi.fn()
    const listReply = vi.fn()

    await handleReloadmodels({}, reloadReply)
    await handleGetmodels({}, listReply)

    expect(runtime.refresh).toHaveBeenCalledOnce()
    expect(runtime.getAvailable).toHaveBeenCalledOnce()
    expect(reloadReply).toHaveBeenCalledWith({ type: 'reloadModels-done', ok: true })
    expect(listReply).toHaveBeenCalledWith({
      type: 'getModels-done',
      models: [{
        id: 'gpt/new',
        name: 'GPT New',
        provider: 'openai',
        contextWindow: 0,
        maxOutput: 0,
        available: true,
      }],
    })
  })
})

describe('worker context preview handler', () => {
  it('uses the persisted-message metric even when the live session has a system prompt', async () => {
    st.currentSessionId = 'session-a'
    st.session = {
      sessionFile: '/sessions/a.jsonl',
      systemPrompt: 'live-only-system-prompt',
      messages: [{ role: 'user', content: 'hello' }],
    } as never
    const reply = vi.fn()

    await handleGetsessioncontextpreview({ sessionFile: '/sessions/a.jsonl' }, reply)

    expect(reply).toHaveBeenCalledWith({
      type: 'getSessionContextPreview-done',
      preview: expect.objectContaining({
        sessionFile: '/sessions/a.jsonl',
        estimatedChars: 5,
        roleBreakdown: [{ role: 'user', chars: 5 }],
      }),
    })
  })
})
