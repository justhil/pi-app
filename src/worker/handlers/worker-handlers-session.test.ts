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
  settingsManager?: {
    getDefaultProvider: () => string | undefined
    getDefaultModel: () => string | undefined
    setDefaultModelAndProvider: (provider: string, modelId: string) => void
  }
}): AgentSession {
  const current = options.current ?? { provider: 'anthropic', id: 'old' }
  return {
    model: current,
    thinkingLevel: 'medium',
    settingsManager: options.settingsManager,
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

  it('restores the global default model after a session-scoped switch', async () => {
    let defaultModel = 'old'
    let defaultProvider = 'anthropic'
    const setDefault = vi.fn((provider: string, modelId: string) => {
      defaultProvider = provider
      defaultModel = modelId
    })
    const current = { provider: 'anthropic', id: 'old' }
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      current,
      // 模拟 SDK：setModel 同时改写会话模型与全局默认。
      setModel: async () => {
        Object.assign(current, { provider: 'openai', id: 'gpt/new' })
        defaultProvider = 'openai'
        defaultModel = 'gpt/new'
      },
      settingsManager: {
        getDefaultProvider: () => defaultProvider,
        getDefaultModel: () => defaultModel,
        setDefaultModelAndProvider: setDefault,
      },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    // 会话模型已切换，但全局默认被还原为切前的值。
    expect(setDefault).toHaveBeenCalledWith('anthropic', 'old')
    expect(reply).toHaveBeenCalledWith({ type: 'setModel-done', modelId: 'openai/gpt/new' })
  })

  it('restores the global default even when the switch fails after the SDK wrote it', async () => {
    let defaultModel = 'old'
    let defaultProvider = 'anthropic'
    const setDefault = vi.fn((provider: string, modelId: string) => {
      defaultProvider = provider
      defaultModel = modelId
    })
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      // SDK 语义：setModel 先写默认再可能抛错（如 thinking 重钳制失败）。
      setModel: async () => {
        defaultProvider = 'openai'
        defaultModel = 'gpt/new'
        throw new Error('clamp failed')
      },
      settingsManager: {
        getDefaultProvider: () => defaultProvider,
        getDefaultModel: () => defaultModel,
        setDefaultModelAndProvider: setDefault,
      },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(reply).toHaveBeenCalledWith({ type: 'error', error: 'clamp failed' })
    expect(setDefault).toHaveBeenCalledWith('anthropic', 'old')
  })

  it('does not write a default when none was configured before the switch', async () => {
    const setDefault = vi.fn()
    const current = { provider: 'anthropic', id: 'old' }
    st.modelRuntime = modelRuntimeWith(() => ({ provider: 'openai', id: 'gpt/new' }))
    st.session = sessionWith({
      current,
      setModel: async () => { Object.assign(current, { provider: 'openai', id: 'gpt/new' }) },
      settingsManager: {
        getDefaultProvider: () => undefined,
        getDefaultModel: () => undefined,
        setDefaultModelAndProvider: setDefault,
      },
    })
    const reply = vi.fn()

    await handleSetmodel({ provider: 'openai', modelId: 'gpt/new' }, reply)

    expect(setDefault).not.toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith({ type: 'setModel-done', modelId: 'openai/gpt/new' })
  })

  it('leaves the default untouched when the session has no settings manager', async () => {
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
