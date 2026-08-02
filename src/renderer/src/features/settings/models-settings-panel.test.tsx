import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  commitAllSettingsSlices,
  getDirtySettingsSlices,
} from './settings-dirty-registry'
import { ModelsSettingsPanel } from './models-settings-panel'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

vi.mock('./models-provider-card', () => ({
  ModelsProviderCard: ({
    onUpdateProvider,
    remoteIds = [],
  }: {
    onUpdateProvider: (patch: { name: string }) => void
    remoteIds?: string[]
  }) => (
    <>
      <button type="button" onClick={() => onUpdateProvider({ name: 'Changed provider' })}>
        edit provider
      </button>
      <div>{remoteIds.map((id) => <span key={id}>{id}</span>)}</div>
    </>
  ),
}))

const initialConfig = {
  providers: {
    custom: {
      name: 'Original provider',
      baseUrl: 'https://example.invalid/v1',
      models: [{ id: 'model-a' }],
    },
  },
}

const normalizedConfig = {
  providers: {
    custom: {
      name: 'Changed provider',
      baseUrl: 'https://example.invalid/v1',
      models: [{ id: 'model-a' }],
    },
  },
}

const catalogModels = [
  {
    id: 'store-only',
    name: 'Store only',
    provider: 'custom',
    contextWindow: 128000,
    maxOutput: 4096,
    available: true,
  },
]

function getRequest(method: string) {
  return vi.mocked(ipcClient.invoke).mock.calls.filter(([name]) => name === method)
}

beforeEach(() => {
  vi.mocked(ipcClient.invoke).mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ModelsSettingsPanel save', () => {
  it('writes the edited provider, reloads the normalized config, and clears dirty state', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({ models: catalogModels })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockResolvedValueOnce({ path: 'models.json', config: normalizedConfig })
      .mockResolvedValueOnce({ models: catalogModels })

    render(<ModelsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit provider' }))
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['pi-models']))

    await act(async () => {
      await commitAllSettingsSlices()
    })

    expect(getRequest('pi.models.set')).toEqual([
      ['pi.models.set', { config: normalizedConfig }],
    ])
    expect(getRequest('pi.models.get')).toHaveLength(2)
    expect(getRequest('model.list')).toEqual([
      ['model.list', { scope: 'catalog' }],
      ['model.list', { scope: 'catalog' }],
    ])
    await waitFor(() => expect(getDirtySettingsSlices()).toEqual([]))
  })

  it('keeps the edited provider dirty and displays the write error', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({ models: [] })
      .mockResolvedValueOnce({ ok: false, path: 'models.json', error: 'invalid provider config' })

    render(<ModelsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit provider' }))

    await act(async () => {
      await expect(commitAllSettingsSlices()).rejects.toThrow('invalid provider config')
    })

    expect(getRequest('pi.models.get')).toHaveLength(1)
    expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['pi-models'])
    expect(screen.getByText('invalid provider config')).toBeTruthy()
  })

  it('keeps the edited provider dirty when post-save reload fails', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({ models: [] })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockRejectedValueOnce(new Error('reload failed'))

    render(<ModelsSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit provider' }))

    await act(async () => {
      await expect(commitAllSettingsSlices()).rejects.toThrow('reload failed')
    })

    expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['pi-models'])
    expect(screen.getByText('reload failed')).toBeTruthy()
  })

  it('shows SDK catalog providers when models.json is absent or empty', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: { providers: {} } })
      .mockResolvedValueOnce({ models: catalogModels })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText('custom')).toBeTruthy()
    expect(screen.getByText('store-only')).toBeTruthy()
    expect(getRequest('pi.models.set')).toEqual([])
  })

  it('displays SDK catalog models when models.json only has overrides and saves only the config draft', async () => {
    const overrideOnlyConfig = {
      providers: {
        custom: {
          name: 'Custom provider',
          models: [{ id: 'override-only' }],
          modelOverrides: { 'store-only': { contextWindow: 64000 } },
        },
      },
    }
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: overrideOnlyConfig })
      .mockResolvedValueOnce({ models: catalogModels })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockResolvedValueOnce({ path: 'models.json', config: overrideOnlyConfig })
      .mockResolvedValueOnce({ models: catalogModels })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText('store-only')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'edit provider' }))
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['pi-models']))
    await act(async () => {
      await commitAllSettingsSlices()
    })

    expect(getRequest('pi.models.set')).toEqual([
      ['pi.models.set', { config: expect.objectContaining({
        providers: expect.objectContaining({
          custom: expect.objectContaining({
            models: [{ id: 'override-only' }],
            modelOverrides: { 'store-only': { contextWindow: 64000 } },
          }),
        }),
      }) }],
    ])
    expect(getRequest('model.list')).toEqual([
      ['model.list', { scope: 'catalog' }],
      ['model.list', { scope: 'catalog' }],
    ])
  })
})
