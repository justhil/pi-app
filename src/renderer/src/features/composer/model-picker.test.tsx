import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

const { toastSpies, userActionToastMock } = vi.hoisted(() => ({
  toastSpies: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    error: vi.fn(),
  },
  userActionToastMock: { success: vi.fn() },
}))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({ adapters: [] })) },
}))
vi.mock('sonner', () => ({ toast: toastSpies }))
vi.mock('@renderer/lib/startup-toast-guard', () => ({ userActionToast: userActionToastMock }))

const invoke = vi.mocked(ipcClient.invoke)

beforeEach(() => {
  invoke.mockReset()
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

  it('optimistically closes while switching and applies the returned runtime model', async () => {
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

    expect(useUIStore.getState().runState.model).toBe('openai/gpt/new')
    expect(useUIStore.getState().modelPickerOpen).toBe(false)

    confirmSwitch?.({ modelId: 'openai/gpt/new' })
    await waitFor(() => expect(useUIStore.getState().runState.model).toBe('openai/gpt/new'))
    await waitFor(() => expect(useUIStore.getState().modelPickerOpen).toBe(false))
    // The boot-guard bypass must still surface a user-initiated success toast.
    await waitFor(() =>
      expect(userActionToastMock.success).toHaveBeenCalledWith(expect.stringContaining('openai/gpt/new')),
    )
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
