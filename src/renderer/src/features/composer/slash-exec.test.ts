import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand } from './slash-exec'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({ adapters: [] })) },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const invoke = vi.mocked(ipcClient.invoke)

beforeEach(() => {
  invoke.mockReset()
  useUIStore.setState({
    historySessionFile: 'C:/sessions/current.jsonl',
    runState: { ...useUIStore.getState().runState, model: 'anthropic/old' },
  })
})

describe('/model runtime confirmation', () => {
  it('resolves model names from only available models', async () => {
    invoke.mockImplementation(async (method) => {
      if (method === 'model.list') return { models: [{ provider: 'openai', id: 'gpt-4', name: 'GPT 4' }] }
      if (method === 'model.set') return { modelId: 'openai/gpt-4' }
      throw new Error(`unexpected ${method}`)
    })

    await executeSlashCommand('/model GPT 4')

    expect(invoke).toHaveBeenCalledWith('model.list', { scope: 'available' })
  })

  it('preserves slashes in the model id and applies the Worker-confirmed model', async () => {
    invoke.mockResolvedValue({ modelId: 'openai/org/model/v2' })

    await executeSlashCommand('/model openai/org/model/v2')

    expect(invoke).toHaveBeenCalledWith('model.set', {
      sessionId: '',
      sessionFile: 'C:/sessions/current.jsonl',
      provider: 'openai',
      modelId: 'org/model/v2',
    })
    expect(useUIStore.getState().runState.model).toBe('openai/org/model/v2')
  })

  it('preselects an unbound new-session model without changing a live Worker', async () => {
    useUIStore.setState({ historySessionFile: null })

    await executeSlashCommand('/model openai/org/model/v2')

    expect(invoke).not.toHaveBeenCalled()
    expect(useUIStore.getState().runState.model).toBe('openai/org/model/v2')
  })

  it('keeps the confirmed model when the Worker rejects the switch', async () => {
    invoke.mockRejectedValue(new Error('provider rejected model'))

    await executeSlashCommand('/model openai/org/model/v2')

    expect(useUIStore.getState().runState.model).toBe('anthropic/old')
  })
})
