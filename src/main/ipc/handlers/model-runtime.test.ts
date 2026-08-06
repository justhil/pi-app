import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  readModelsConfigRaw: vi.fn(),
  fetchRemoteModelsCached: vi.fn(),
  updateModelsConfigLight: vi.fn(),
  reloadModels: vi.fn(),
  workerRunning: true,
  setModel: vi.fn(),
  resolveAvailableModels: vi.fn(),
  resolveCatalogModels: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../../pi-models-json', () => ({
  readModelsConfigRaw: mocks.readModelsConfigRaw,
  modelsCatalogFromConfig: vi.fn((config: { providers: Record<string, unknown> }) => {
    const out: Array<{ id: string; name: string; provider: string }> = []
    for (const [provider, prov] of Object.entries(config.providers || {})) {
      for (const model of (prov as { models?: { id?: string }[] }).models || []) {
        if (model.id) out.push({ id: model.id, name: model.id, provider })
      }
    }
    return out
  }),
  fetchRemoteModelsCached: mocks.fetchRemoteModelsCached,
  updateModelsConfigLight: mocks.updateModelsConfigLight,
}))

vi.mock('../../worker-manager', () => ({
  workerManager: {
    get isRunning() {
      return mocks.workerRunning
    },
    cwd: '/project',
    reloadModels: mocks.reloadModels,
    setModel: mocks.setModel,
    hasActiveTurns: false,
  },
}))

vi.mock('../../config-store', () => ({ configStore: { get: vi.fn(() => '') } }))
vi.mock('../../sandbox-workspaces', () => ({ isSandboxWorkspacePath: vi.fn(() => false) }))
vi.mock('../sdk-session', () => ({ getActiveSdkModule: vi.fn() }))
vi.mock('../../active-sdk-models', () => ({
  listAvailableModelsWithSdk: vi.fn(async () => []),
  listCatalogModelsWithSdk: vi.fn(async () => []),
  resolveAvailableModels: mocks.resolveAvailableModels,
  resolveCatalogModels: mocks.resolveCatalogModels,
}))

import { registerModelRuntimeHandlers } from './model-runtime'

const gatewayConfig = {
  providers: {
    acme: {
      baseUrl: 'https://ai-gateway.example/v1',
      api: 'openai-completions',
      apiKey: 'acme-key',
    },
  },
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.readModelsConfigRaw.mockReset().mockReturnValue({ config: gatewayConfig })
  mocks.fetchRemoteModelsCached.mockReset()
  mocks.updateModelsConfigLight.mockReset().mockImplementation(async (apply: (current: Record<string, unknown>) => Record<string, unknown>) => {
    const current = mocks.readModelsConfigRaw().config
    const next = apply(current as never)
    return { ok: true, path: '~/.pi/agent/models.json', changed: next !== current }
  })
  mocks.reloadModels.mockReset().mockResolvedValue(undefined)
  mocks.setModel.mockReset().mockResolvedValue('acme/Hy3')
  mocks.resolveAvailableModels.mockReset()
  mocks.resolveCatalogModels.mockReset()
  mocks.workerRunning = true
  registerModelRuntimeHandlers()
})

describe('model.list remote merge', () => {
  it('fetches gateway chat models when worker and sdk lists are empty', async () => {
    mocks.resolveAvailableModels.mockResolvedValue([])
    mocks.fetchRemoteModelsCached.mockResolvedValue({
      ok: true,
      models: [
        { id: 'Hy3', name: 'Hy3', modelType: 'chat' },
        { id: 'claude-sonnet-5', name: 'claude-sonnet-5', modelType: 'chat' },
        { id: 'Banana-1', name: 'Banana-1', modelType: 'image' },
        { id: 'Hailuo-02', name: 'Hailuo-02', modelType: 'video' },
      ],
    })

    const response = await mocks.handlers.get('ipc:model.list')!({ scope: 'available' })

    expect(mocks.fetchRemoteModelsCached).toHaveBeenCalledWith(
      { baseUrl: 'https://ai-gateway.example/v1', apiKey: 'acme-key', authHeader: undefined },
      { timeoutMs: 4000 },
    )
    expect(response).toEqual({
      models: [
        expect.objectContaining({ id: 'Hy3', provider: 'acme', available: true }),
        expect.objectContaining({ id: 'claude-sonnet-5', provider: 'acme', available: true }),
      ],
    })
    expect((response as { models: Array<{ id: string }> }).models.map((m) => m.id)).not.toContain('Banana-1')
  })

  it('merges remote models even when the worker already returns local models', async () => {
    mocks.resolveAvailableModels.mockResolvedValue([
      { id: 'Hy3', name: 'Hy3', provider: 'acme', contextWindow: 128000, maxOutput: 4096, available: true },
    ])
    mocks.fetchRemoteModelsCached.mockResolvedValue({
      ok: true,
      models: [
        { id: 'Hy3', name: 'Hy3', modelType: 'chat' },
        { id: 'claude-sonnet-5', name: 'claude-sonnet-5', modelType: 'chat' },
      ],
    })

    const response = await mocks.handlers.get('ipc:model.list')!({ scope: 'available' })

    expect(mocks.fetchRemoteModelsCached).toHaveBeenCalledOnce()
    // 本地条目优先（保留 contextWindow），远程补充未声明的 claude-sonnet-5
    expect(response).toEqual({
      models: [
        { id: 'Hy3', name: 'Hy3', provider: 'acme', contextWindow: 128000, maxOutput: 4096, available: true },
        { id: 'claude-sonnet-5', name: 'claude-sonnet-5', provider: 'acme', contextWindow: 0, maxOutput: 0, available: true },
      ],
    })
  })

  it('returns local models when the gateway fetch fails', async () => {
    mocks.resolveAvailableModels.mockResolvedValue([
      { id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', contextWindow: 128000, maxOutput: 4096, available: true },
    ])
    mocks.fetchRemoteModelsCached.mockResolvedValue({ ok: false, error: 'HTTP 401' })

    const response = await mocks.handlers.get('ipc:model.list')!({ scope: 'available' })

    expect(response).toEqual({ models: [{ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai', contextWindow: 128000, maxOutput: 4096, available: true }] })
  })

  it('returns empty when everything fails', async () => {
    mocks.resolveAvailableModels.mockResolvedValue([])
    mocks.fetchRemoteModelsCached.mockResolvedValue({ ok: false, error: 'HTTP 401' })

    const response = await mocks.handlers.get('ipc:model.list')!({ scope: 'available' })

    expect(response).toEqual({ models: [] })
  })
})

describe('model.set auto-register', () => {
  it('writes a minimal model entry and reloads before setting a fetched model', async () => {
    let applied: Record<string, unknown> | undefined
    mocks.updateModelsConfigLight.mockImplementation(async (apply) => {
      const current = mocks.readModelsConfigRaw().config
      const next = apply(current as never)
      applied = next as Record<string, unknown>
      return { ok: true, path: '~/.pi/agent/models.json', changed: next !== current }
    })

    const response = await mocks.handlers.get('ipc:model.set')!({
      provider: 'acme',
      modelId: 'Hy3',
      sessionFile: '/project/sessions/abc.session.json',
    })

    expect(applied).toMatchObject({
      providers: {
        acme: {
          baseUrl: 'https://ai-gateway.example/v1',
          models: [expect.objectContaining({ id: 'Hy3', input: ['text'] })],
        },
      },
    })
    expect(mocks.reloadModels).toHaveBeenCalledOnce()
    expect(mocks.setModel).toHaveBeenCalledWith('acme', 'Hy3', '/project/sessions/abc.session.json')
    expect(response).toEqual({ modelId: 'acme/Hy3' })
  })

  it('skips auto-register when the model is already declared', async () => {
    mocks.readModelsConfigRaw.mockReturnValue({
      config: {
        providers: {
          acme: { baseUrl: 'https://ai-gateway.example/v1', api: 'openai-completions', models: [{ id: 'Hy3' }] },
        },
      },
    })

    await mocks.handlers.get('ipc:model.set')!({ provider: 'acme', modelId: 'Hy3', sessionFile: '/x.session.json' })

    expect(mocks.reloadModels).not.toHaveBeenCalled()
    expect(mocks.setModel).toHaveBeenCalledOnce()
  })

  it('skips auto-register for providers not configured in models.json', async () => {
    mocks.readModelsConfigRaw.mockReturnValue({ config: { providers: {} } })

    await mocks.handlers.get('ipc:model.set')!({ provider: 'anthropic', modelId: 'claude-sonnet-5' })

    expect(mocks.reloadModels).not.toHaveBeenCalled()
    expect(mocks.setModel).toHaveBeenCalledWith('anthropic', 'claude-sonnet-5', undefined)
  })
})
