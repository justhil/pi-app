import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  clearAvailableModelsCacheForTests,
  ensureAvailableModels,
  invalidateAvailableModels,
  peekAvailableModels,
  prefetchAvailableModels,
  refreshAvailableModels,
  subscribeAvailableModels,
} from './available-models-cache'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
}))

const invoke = vi.mocked(ipcClient.invoke)
const models = [{
  provider: 'openai',
  id: 'gpt-5',
  name: 'GPT-5',
  available: true,
  contextWindow: 128000,
  maxOutput: 8192,
}]

beforeEach(() => {
  invoke.mockReset()
  clearAvailableModelsCacheForTests()
})

describe('available model cache', () => {
  it('coalesces concurrent refreshes and publishes the successful snapshot', async () => {
    let resolveRequest: ((value: { models: typeof models }) => void) | undefined
    invoke.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
    const listener = vi.fn()
    subscribeAvailableModels(listener)

    const first = refreshAvailableModels()
    const second = refreshAvailableModels()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('model.list', { scope: 'available' })
    resolveRequest?.({ models })
    await expect(first).resolves.toEqual(models)
    await expect(second).resolves.toEqual(models)
    expect(peekAvailableModels()).toEqual(models)
    expect(listener).toHaveBeenCalledWith(models)
  })

  it('does not re-request a warm snapshot during prefetch', async () => {
    invoke.mockResolvedValueOnce({ models })
    await refreshAvailableModels()
    invoke.mockClear()

    prefetchAvailableModels()
    await Promise.resolve()

    expect(invoke).not.toHaveBeenCalled()
  })

  it('retries after a failed refresh instead of freezing the stale snapshot', async () => {
    invoke.mockResolvedValueOnce({ models })
    await refreshAvailableModels()
    invalidateAvailableModels()
    invoke.mockRejectedValueOnce(new Error('offline'))

    await expect(ensureAvailableModels()).rejects.toThrow('offline')
    invoke.mockResolvedValueOnce({ models: [{ ...models[0], id: 'gpt-5.1' }] })
    await expect(ensureAvailableModels()).resolves.toMatchObject([{ id: 'gpt-5.1' }])
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('drops an old in-flight result after invalidation', async () => {
    let resolveOld: ((value: { models: typeof models }) => void) | undefined
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const oldRequest = refreshAvailableModels()
    invalidateAvailableModels()
    const newerModels = [{ ...models[0], id: 'gpt-5.2' }]
    invoke.mockResolvedValueOnce({ models: newerModels })

    await expect(ensureAvailableModels()).resolves.toEqual(newerModels)
    resolveOld?.({ models })
    await expect(oldRequest).resolves.toEqual(newerModels)
    expect(peekAvailableModels()).toEqual(newerModels)
  })

  it('preserves a previous snapshot when refresh fails', async () => {
    invoke.mockResolvedValueOnce({ models })
    await refreshAvailableModels()
    invoke.mockRejectedValueOnce(new Error('offline'))

    await expect(refreshAvailableModels()).rejects.toThrow('offline')
    expect(peekAvailableModels()).toEqual(models)
  })
})
