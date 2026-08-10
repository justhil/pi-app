import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'
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
  useUIStore.setState({
    modelPickerOpen: true,
    historySessionFile: 'C:/sessions/one.jsonl',
    runState: { ...useUIStore.getState().runState, model: 'anthropic/old' },
  })
})

describe('ModelPicker runtime confirmation', () => {
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
