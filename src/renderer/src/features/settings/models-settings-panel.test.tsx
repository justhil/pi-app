import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import {
  commitAllSettingsSlices,
  getDirtySettingsSlices,
} from './settings-dirty-registry'
import { ModelsSettingsPanel } from './models-settings-panel'

const appEventListeners = new Set<(event: { type: string }) => void>()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
  onAppEvent: (listener: (event: { type: string }) => void) => {
    appEventListeners.add(listener)
    return () => appEventListeners.delete(listener)
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

vi.mock('./models-provider-card', () => ({
  ModelsProviderCard: ({
    onUpdateProvider,
    remoteIds = [],
    config,
    pid = '',
  }: {
    onUpdateProvider: (patch: { name: string }) => void
    remoteIds?: string[]
    config?: { providers?: Record<string, { models?: Array<{ id: string }> }> }
    pid?: string
  }) => (
    <>
      <button type="button" onClick={() => onUpdateProvider({ name: 'Changed provider' })}>
        edit provider
      </button>
      <div>{remoteIds.map((id) => <span key={`remote:${id}`}>{id}</span>)}</div>
      <div>{(config?.providers?.[pid]?.models || []).map(({ id }) => <span key={`configured:${id}`}>{id}</span>)}</div>
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

const availableModels = [
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
  appEventListeners.clear()
})

afterEach(() => {
  cleanup()
})

describe('ModelsSettingsPanel save', () => {
  it('writes the edited provider, reloads the normalized config, and clears dirty state', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({ models: availableModels })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockResolvedValueOnce({ path: 'models.json', config: normalizedConfig })
      .mockResolvedValueOnce({ models: availableModels })

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
      ['model.list', { scope: 'settings' }],
      ['model.list', { scope: 'settings' }],
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

  it('shows configured models plus the non-network SDK settings snapshot', async () => {
    const providerSettingsModels = [
      ...availableModels,
      {
        id: 'model-a',
        name: 'Configured duplicate',
        provider: 'custom',
        contextWindow: 128000,
        maxOutput: 4096,
        available: true,
      },
      {
        id: 'logged-in',
        name: 'Logged in',
        provider: 'anthropic',
        contextWindow: 200000,
        maxOutput: 8192,
        available: true,
      },
    ]
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({ models: providerSettingsModels })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText('store-only')).toBeTruthy()
    expect(screen.getByText('logged-in')).toBeTruthy()
    expect(screen.getAllByText('model-a')).toHaveLength(2)
    expect(getRequest('model.list')).toEqual([
      ['model.list', { scope: 'settings' }],
    ])
    expect(providerSettingsModels[0].available).toBe(true)
    expect(getRequest('pi.models.set')).toEqual([])
  })

  it('keeps SDK runtime rows read-only when the provider also exists in models.json', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: initialConfig })
      .mockResolvedValueOnce({
        models: [{
          ...availableModels[0],
          managedBy: 'active-sdk',
          auth: { supported: true, configured: true, source: 'environment', type: 'api_key' },
        }],
      })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockResolvedValueOnce({ path: 'models.json', config: normalizedConfig })
      .mockResolvedValueOnce({ models: availableModels })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText('store-only')).toBeTruthy()
    expect(screen.getByText(/SDK-managed.*read-only/i)).toBeTruthy()
    expect(screen.getByText(/API key.*environment/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'edit provider' }))
    await waitFor(() => expect(getDirtySettingsSlices().map((slice) => slice.id)).toEqual(['pi-models']))
    await act(async () => {
      await commitAllSettingsSlices()
    })

    expect(getRequest('pi.models.set')).toEqual([
      ['pi.models.set', { config: normalizedConfig }],
    ])
  })

  it('reloads the active-SDK projection after a runtime change event', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: { providers: {} } })
      .mockResolvedValueOnce({ models: availableModels })
      .mockResolvedValueOnce({ path: 'models.json', config: { providers: {} } })
      .mockResolvedValueOnce({ models: [{ ...availableModels[0], id: 'after-switch' }] })

    render(<ModelsSettingsPanel />)
    expect(await screen.findByText('store-only')).toBeTruthy()

    act(() => {
      for (const listener of appEventListeners) listener({ type: 'sdk-runtime-changed' })
    })

    expect(await screen.findByText('after-switch')).toBeTruthy()
    expect(getRequest('model.list')).toEqual([
      ['model.list', { scope: 'settings' }],
      ['model.list', { scope: 'settings' }],
    ])
  })

  it('shows SDK catalog providers as active-SDK managed read-only with redacted auth status', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: { providers: {} } })
      .mockResolvedValueOnce({
        models: [{
          ...availableModels[0],
          managedBy: 'active-sdk',
          auth: { supported: true, configured: true, source: 'stored', type: 'oauth' },
        }],
      })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText('custom')).toBeTruthy()
    expect(screen.getByText('store-only')).toBeTruthy()
    expect(screen.getByText(/SDK-managed.*read-only/i)).toBeTruthy()
    expect(screen.getByText(/OAuth.*stored/i)).toBeTruthy()
    expect(getRequest('pi.models.set')).toEqual([])
  })

  it('shows missing and unknown auth states without guessing from editable fields', async () => {
    vi.mocked(ipcClient.invoke)
      .mockResolvedValueOnce({ path: 'models.json', config: { providers: {} } })
      .mockResolvedValueOnce({
        models: [
          {
            ...availableModels[0],
            available: false,
            managedBy: 'active-sdk',
            auth: { supported: true, configured: false },
          },
          {
            ...availableModels[0],
            id: 'unknown-auth',
            provider: 'legacy',
            managedBy: 'active-sdk',
            auth: { supported: false },
          },
        ],
      })

    render(<ModelsSettingsPanel />)

    expect(await screen.findByText(/SDK-managed.*auth not configured/i)).toBeTruthy()
    expect(screen.getByText(/SDK-managed.*auth status unavailable/i)).toBeTruthy()
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
      .mockResolvedValueOnce({ models: availableModels })
      .mockResolvedValueOnce({ ok: true, path: 'models.json' })
      .mockResolvedValueOnce({ path: 'models.json', config: overrideOnlyConfig })
      .mockResolvedValueOnce({ models: availableModels })

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
      ['model.list', { scope: 'settings' }],
      ['model.list', { scope: 'settings' }],
    ])
  })
})
