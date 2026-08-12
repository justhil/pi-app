import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useExtensionUIStore } from '@renderer/stores/extension-ui-store'
import { executeSlashCommand } from './slash-exec'
import { clearAvailableModelsCacheForTests } from '@renderer/lib/available-models-cache'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn(() => Promise.resolve({ adapters: [] })) },
}))
vi.mock('@renderer/lib/extension-ui-channel', () => ({ clearExtensionDialogDedupe: vi.fn() }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const invoke = vi.mocked(ipcClient.invoke)

beforeEach(() => {
  invoke.mockReset()
  clearAvailableModelsCacheForTests()
  useUIStore.setState({
    historySessionFile: 'C:/sessions/current.jsonl',
    runState: { ...useUIStore.getState().runState, model: 'anthropic/old' },
    currentWorkspace: 'C:/workspace',
    workerLiveSnapshot: {
      sessionId: 'old-session',
      sessionFile: 'C:/sessions/current.jsonl',
      status: 'running',
    },
  })
  useExtensionUIStore.setState({ activePending: null, suspended: null })
})

describe('/new session reset', () => {
  it('clears old extension UI and worker state', async () => {
    useExtensionUIStore.setState({
      activePending: { id: 'dialog-1', method: 'confirm', title: 'Confirm', message: 'Continue?' },
      suspended: null,
    })

    await executeSlashCommand('/new')

    expect(useExtensionUIStore.getState().activePending).toBeNull()
    expect(useUIStore.getState().workerLiveSnapshot).toEqual({
      sessionId: null,
      sessionFile: null,
      status: 'idle',
    })
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

  it('resolves a model name immediately from the warm available-model cache', async () => {
    invoke.mockImplementation(async (method) => {
      if (method === 'model.list') return { models: [{ provider: 'openai', id: 'gpt-4', name: 'GPT 4' }] }
      if (method === 'model.set') return { modelId: 'openai/gpt-4' }
      throw new Error(`unexpected ${method}`)
    })
    const { refreshAvailableModels } = await import('@renderer/lib/available-models-cache')
    await refreshAvailableModels()
    invoke.mockClear()

    await executeSlashCommand('/model GPT 4')

    expect(invoke.mock.calls.filter(([method]) => method === 'model.list')).toEqual([])
    expect(invoke).toHaveBeenCalledWith('model.set', expect.objectContaining({
      provider: 'openai',
      modelId: 'gpt-4',
    }))
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
