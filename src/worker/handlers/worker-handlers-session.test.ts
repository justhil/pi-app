import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { WorkerModelRuntime } from '../worker-runtime'
import { handleSetmodel } from './worker-handlers-session'
import { st } from '../worker-runtime'

function modelRuntimeWith(getModel: (provider: string, modelId: string) => unknown): WorkerModelRuntime {
  return {
    getModel: vi.fn(getModel),
    getAvailable: vi.fn(async () => []),
    refresh: vi.fn(async () => ({ providers: [] })),
  } as unknown as WorkerModelRuntime
}

function sessionWith(options: {
  current?: { provider: string; id: string }
  setModel?: (model: { provider: string; id: string }) => Promise<void>
}): AgentSession {
  const current = options.current ?? { provider: 'anthropic', id: 'old' }
  return {
    model: current,
    thinkingLevel: 'medium',
    setModel: options.setModel ?? (async (model) => Object.assign(current, model)),
  } as unknown as AgentSession
}

afterEach(() => {
  st.session = null
  st.modelRuntime = null
})

describe('handleSetmodel', () => {
  it('resolves through the service-owned ModelRuntime without session.modelRegistry', async () => {
    const model = { provider: 'openai', id: 'gpt/new' }
    const current = { provider: 'anthropic', id: 'old' }
    const modelRuntime = modelRuntimeWith(() => model)
    st.modelRuntime = modelRuntime
    st.session = sessionWith({
      current,
      setModel: async () => { Object.assign(current, model) },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(modelRuntime.getModel).toHaveBeenCalledWith('openai', 'gpt/new')
    expect(reply).toHaveBeenCalledWith({ type: 'setModel-done', modelId: 'openai/gpt/new' })
  })

  it('rejects a model missing from the service-owned ModelRuntime', async () => {
    st.modelRuntime = modelRuntimeWith(() => undefined)
    st.session = sessionWith({})
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'MODEL_NOT_FOUND: openai/gpt/new' })
  })

  it('reports setModel failure instead of silently confirming success', async () => {
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      setModel: async () => { throw new Error('provider rejected model') },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'provider rejected model' })
  })

  it('rejects when the runtime remains on the previous model', async () => {
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      setModel: async () => undefined,
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'MODEL_NOT_CONFIRMED: anthropic/old' })
  })

  it('returns the actual runtime model after confirmation', async () => {
    const current = { provider: 'anthropic', id: 'old' }
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      current,
      setModel: async () => { Object.assign(current, { provider: 'openai', id: 'gpt/new' }) },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'setModel-done', modelId: 'openai/gpt/new' })
  })
})
