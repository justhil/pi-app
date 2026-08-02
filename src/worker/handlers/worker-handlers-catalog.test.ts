import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleGetmodels, handleReloadmodels } from './worker-handlers-catalog'
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
