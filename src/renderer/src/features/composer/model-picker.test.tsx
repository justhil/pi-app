import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'
import {
  clearAvailableModelsCacheForTests,
  refreshAvailableModels,
} from '@renderer/lib/available-models-cache'
import { ipcClient, onAppEvent } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AppEvent } from '@shared/app-events'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({ adapters: [] })) },
  onAppEvent: vi.fn(() => () => {}),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const invoke = vi.mocked(ipcClient.invoke)
const onAppEventMock = vi.mocked(onAppEvent)

let appEventSubscribers: Array<(event: AppEvent) => void> = []

beforeEach(() => {
  invoke.mockReset()
  appEventSubscribers = []
  onAppEventMock.mockImplementation((cb) => {
    appEventSubscribers.push(cb)
    return () => {}
  })
  clearAvailableModelsCacheForTests()
  useUIStore.setState({
    modelPickerOpen: true,
    historySessionFile: 'C:/sessions/one.jsonl',
    runState: { ...useUIStore.getState().runState, model: 'anthropic/old' },
  })
})

describe('ModelPicker runtime confirmation', () => {
  it('renders a warm cached list before the open refresh resolves', async () => {
    invoke.mockResolvedValueOnce({ models: [{ provider: 'openai', id: 'cached', available: true }] })
    await refreshAvailableModels()
    let resolveRefresh: ((value: { models: Array<{ provider: string; id: string; available: boolean }> }) => void) | undefined
    invoke.mockImplementation(() => new Promise((resolve) => { resolveRefresh = resolve }))

    render(<ModelPicker />)

    expect(screen.getByRole('button', { name: /openai/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /openai/i }))
    expect(screen.getByRole('button', { name: /cached/i })).toBeTruthy()
    expect(invoke.mock.calls.filter(([method]) => method === 'model.list')).toHaveLength(2)

    resolveRefresh?.({ models: [{ provider: 'openai', id: 'fresh', available: true }] })
    expect(await screen.findByRole('button', { name: /fresh/i })).toBeTruthy()
  })

  it('keeps cached choices visible when the open refresh fails', async () => {
    invoke.mockResolvedValueOnce({ models: [{ provider: 'openai', id: 'cached', available: true }] })
    await refreshAvailableModels()
    invoke.mockRejectedValueOnce(new Error('offline'))

    render(<ModelPicker />)
    fireEvent.click(screen.getByRole('button', { name: /openai/i }))

    expect(screen.getByRole('button', { name: /cached/i })).toBeTruthy()
    await waitFor(() => expect(invoke.mock.calls.filter(([method]) => method === 'model.list')).toHaveLength(2))
    expect(screen.getByRole('button', { name: /cached/i })).toBeTruthy()
  })

  it('requests only models available for selection', async () => {
    invoke.mockResolvedValue({ models: [] })

    render(<ModelPicker />)

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('model.list', { scope: 'available' }))
  })

  it('reloads available models when the worker binds a session', async () => {
    invoke.mockResolvedValue({ models: [{ provider: 'openai', id: 'gpt-4', available: true }] })

    render(<ModelPicker />)
    await waitFor(() => expect(invoke.mock.calls.filter(([m]) => m === 'model.list')).toHaveLength(1))

    appEventSubscribers.forEach((cb) =>
      cb({ type: 'run', phase: 'state', seq: 1, workspaceId: 'C:/ws', timestamp: Date.now() }),
    )

    await waitFor(() => expect(invoke.mock.calls.filter(([m]) => m === 'model.list')).toHaveLength(2))
    expect(await screen.findByRole('button', { name: /gpt-4/i })).toBeTruthy()
  })

  it('does not reload on non-run events', async () => {
    invoke.mockResolvedValue({ models: [] })

    render(<ModelPicker />)
    await waitFor(() => expect(invoke.mock.calls.filter(([m]) => m === 'model.list')).toHaveLength(1))

    appEventSubscribers.forEach((cb) =>
      cb({ type: 'file', source: 'write', path: 'C:/x.txt', changeType: 'added', seq: 1, workspaceId: 'C:/ws', timestamp: Date.now() }),
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(invoke.mock.calls.filter(([m]) => m === 'model.list')).toHaveLength(1)
  })

  it('keeps the confirmed model selected while switching and applies the returned runtime model', async () => {
    let confirmSwitch: ((value: { modelId: string }) => void) | undefined
    invoke.mockImplementation(async (method) => {
      if (method === 'model.list') {
        return { models: [{ provider: 'openai', id: 'gpt/new', available: true }] }
      }
      if (method === 'model.set') {
        return await new Promise<{ modelId: string }>((resolve) => { confirmSwitch = resolve })
      }
      throw new Error(`unexpected ${method}`)
    })

    render(<ModelPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /openai/i }))
    fireEvent.click(screen.getByRole('button', { name: /gpt\/new/i }))

    expect(useUIStore.getState().runState.model).toBe('anthropic/old')
    expect(screen.getByRole('button', { name: /gpt\/new/i })).toBeDisabled()

    confirmSwitch?.({ modelId: 'openai/gpt/new' })
    await waitFor(() => expect(useUIStore.getState().runState.model).toBe('openai/gpt/new'))
  })

  it('stores a new-session preselection without touching a running Worker', async () => {
    useUIStore.setState({ historySessionFile: null })
    invoke.mockImplementation(async (method) => {
      if (method === 'model.list') {
        return { models: [{ provider: 'openai', id: 'gpt/new', available: true }] }
      }
      throw new Error(`unexpected ${method}`)
    })

    render(<ModelPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /openai/i }))
    fireEvent.click(screen.getByRole('button', { name: /gpt\/new/i }))

    expect(useUIStore.getState().runState.model).toBe('openai/gpt/new')
    expect(useUIStore.getState().modelPickerOpen).toBe(false)
    expect(invoke.mock.calls.filter(([method]) => method === 'model.set')).toEqual([])
  })

  it('restores the confirmed runtime model when switching fails', async () => {
    invoke.mockImplementation(async (method) => {
      if (method === 'model.list') {
        return { models: [{ provider: 'openai', id: 'gpt/new', available: true }] }
      }
      if (method === 'model.set') throw new Error('provider rejected model')
      throw new Error(`unexpected ${method}`)
    })

    render(<ModelPicker />)
    fireEvent.click(await screen.findByRole('button', { name: /openai/i }))
    fireEvent.click(screen.getByRole('button', { name: /gpt\/new/i }))

    await waitFor(() => expect(useUIStore.getState().runState.model).toBe('anthropic/old'))
    expect(useUIStore.getState().modelPickerOpen).toBe(true)
  })
})
