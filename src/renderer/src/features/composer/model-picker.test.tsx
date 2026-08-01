import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({ adapters: [] })) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
