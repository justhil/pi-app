import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { handleSetmodel } from './worker-handlers-session'
import { st } from '../worker-runtime'

function sessionWith(options: {
  models?: Array<{ provider: string; id: string }>
  current?: { provider: string; id: string }
  setModel?: (model: { provider: string; id: string }) => Promise<void>
}): AgentSession {
  const current = options.current ?? { provider: 'anthropic', id: 'old' }
  return {
    modelRegistry: {
      getAvailable: () => options.models ?? [],
      find: (provider: string, id: string) =>
        (options.models ?? []).find((model) => model.provider === provider && model.id === id),
    },
    model: current,
    thinkingLevel: 'medium',
    setModel: options.setModel ?? (async (model) => Object.assign(current, model)),
  } as unknown as AgentSession
}

afterEach(() => {
  st.session = null
})

describe('handleSetmodel', () => {
  it('rejects a model missing from the active session registry', async () => {
    st.session = sessionWith({ models: [{ provider: 'anthropic', id: 'old' }] })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'MODEL_NOT_FOUND: openai/gpt/new' })
  })

  it('reports setModel failure instead of silently confirming success', async () => {
    st.session = sessionWith({
      models: [{ provider: 'openai', id: 'gpt/new' }],
      setModel: async () => { throw new Error('provider rejected model') },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'provider rejected model' })
  })

  it('rejects when the runtime remains on the previous model', async () => {
    st.session = sessionWith({
      models: [{ provider: 'openai', id: 'gpt/new' }],
      setModel: async () => undefined,
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'MODEL_NOT_CONFIRMED: anthropic/old' })
  })

  it('returns the actual runtime model after confirmation', async () => {
    const current = { provider: 'anthropic', id: 'old' }
    st.session = sessionWith({
      current,
      models: [{ provider: 'openai', id: 'gpt/new' }],
      setModel: async () => { Object.assign(current, { provider: 'openai', id: 'gpt/new' }) },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'setModel-done', modelId: 'openai/gpt/new' })
  })
})
