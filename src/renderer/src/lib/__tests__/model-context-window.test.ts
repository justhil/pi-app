import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke } }))

import { findModelForKey, lookupContextWindow } from '@renderer/lib/model-context-window'
import { clearAvailableModelsCacheForTests } from '@renderer/lib/available-models-cache'

const model = (provider: string, id: string, contextWindow: number, name = id) => ({
  provider,
  id,
  name,
  contextWindow,
  maxOutput: 0,
  available: true,
})

describe('findModelForKey', () => {
  // The composer model key is `provider/id`; the old lookup compared it with bare ids and then
  // fell back to substring matching, so `openai/gpt-5.5` resolved to `gpt-5`'s context window.
  it('matches provider/id exactly instead of by substring', () => {
    const models = [model('openai', 'gpt-5', 400_000), model('openai', 'gpt-5.5', 1_000_000)]

    expect(findModelForKey(models, 'openai/gpt-5.5')?.contextWindow).toBe(1_000_000)
  })

  it('keeps provider identity for ids that contain slashes', () => {
    const models = [
      model('anthropic', 'claude-opus', 200_000),
      model('openrouter', 'anthropic/claude-opus', 128_000),
    ]

    expect(findModelForKey(models, 'openrouter/anthropic/claude-opus')?.contextWindow).toBe(128_000)
    expect(findModelForKey(models, 'anthropic/claude-opus')?.contextWindow).toBe(200_000)
  })

  it('returns null rather than guessing a similar model', () => {
    expect(findModelForKey([model('openai', 'gpt-5', 400_000)], 'openai/gpt-5-mini')).toBeNull()
  })
})

describe('lookupContextWindow', () => {
  beforeEach(() => {
    invoke.mockReset()
    clearAvailableModelsCacheForTests()
  })

  it('uses the shared available-models cache without fetching the full catalog', async () => {
    invoke.mockImplementation(async (_channel: string, req: { scope?: string }) =>
      req?.scope === 'available' ? { models: [model('openai', 'gpt-5.5', 1_000_000)] } : { models: [] },
    )

    await expect(lookupContextWindow('openai/gpt-5.5')).resolves.toBe(1_000_000)
    await expect(lookupContextWindow('openai/gpt-5.5')).resolves.toBe(1_000_000)

    expect(invoke.mock.calls.filter(([, req]) => req?.scope === 'catalog')).toHaveLength(0)
    expect(invoke.mock.calls.filter(([, req]) => req?.scope === 'available')).toHaveLength(1)
  })

  it('falls back to the catalog once for models outside the available list', async () => {
    invoke.mockImplementation(async (_channel: string, req: { scope?: string }) =>
      req?.scope === 'catalog' ? { models: [model('custom', 'big', 2_000_000)] } : { models: [] },
    )

    await expect(lookupContextWindow('custom/big')).resolves.toBe(2_000_000)
    await expect(lookupContextWindow('custom/big')).resolves.toBe(2_000_000)

    expect(invoke.mock.calls.filter(([, req]) => req?.scope === 'catalog')).toHaveLength(1)
  })
})
