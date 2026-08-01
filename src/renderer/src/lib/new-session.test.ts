import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const store = {
  runState: { model: 'openai/org/model/v2', thinkingLevel: 'high' },
  clearPendingNewSessionPlaceholder: vi.fn(),
  setCurrentSession: vi.fn(),
  clearFileChanges: vi.fn(),
  setHistoryMeta: vi.fn(),
  setSessions: vi.fn(),
}

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: { getState: () => store },
}))

vi.mock('@renderer/lib/composer-run-display', () => ({
  refreshComposerRunDisplay: vi.fn(),
}))

import { materializePendingNewSession } from './new-session'

describe('new session model preselection', () => {
  beforeEach(() => {
    invoke.mockReset()
    store.clearPendingNewSessionPlaceholder.mockReset()
    store.setCurrentSession.mockReset()
    store.clearFileChanges.mockReset()
    store.setHistoryMeta.mockReset()
    store.setSessions.mockReset()
  })

  it('waits for model confirmation before finishing session materialization', async () => {
    let confirmModel: ((value: { modelId: string }) => void) | undefined
    invoke.mockImplementation((method: string) => {
      if (method === 'session.new') {
        return Promise.resolve({ session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } })
      }
      if (method === 'session.setPendingBind') return Promise.resolve({ ok: true })
      if (method === 'model.set') {
        return new Promise((resolve) => { confirmModel = resolve })
      }
      if (method === 'thinkingLevel.set') return Promise.resolve({ ok: true })
      if (method === 'session.list') return Promise.resolve({ sessions: [] })
      return Promise.resolve({})
    })

    let settled = false
    const materialized = materializePendingNewSession('D:/workspace', 'first prompt').then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('model.set', {
      sessionId: '',
      sessionFile: 'C:/sessions/new.jsonl',
      provider: 'openai',
      modelId: 'org/model/v2',
    }))

    expect(settled).toBe(false)
    expect(invoke).not.toHaveBeenCalledWith('thinkingLevel.set', expect.anything())

    confirmModel?.({ modelId: 'openai/org/model/v2' })
    await materialized

    expect(invoke).toHaveBeenCalledWith('thinkingLevel.set', {
      sessionId: '',
      sessionFile: 'C:/sessions/new.jsonl',
      level: 'high',
    })
  })

  it('rejects materialization when the Worker rejects the preselected model', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'session.new') {
        return { session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } }
      }
      if (method === 'session.setPendingBind') return { ok: true }
      if (method === 'model.set') throw new Error('MODEL_NOT_FOUND')
      return { ok: true }
    })

    await expect(materializePendingNewSession('D:/workspace', 'first prompt')).rejects.toThrow(
      'MODEL_NOT_FOUND',
    )
    expect(invoke).not.toHaveBeenCalledWith('thinkingLevel.set', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('session.list', expect.anything())
  })

  it('rejects materialization when the Worker confirms a different model', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'session.new') {
        return { session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } }
      }
      if (method === 'session.setPendingBind') return { ok: true }
      if (method === 'model.set') return { modelId: 'openai/different-model' }
      return { ok: true }
    })

    await expect(materializePendingNewSession('D:/workspace', 'first prompt')).rejects.toThrow(
      'Model selection was not confirmed: openai/different-model',
    )
    expect(invoke).not.toHaveBeenCalledWith('thinkingLevel.set', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('session.list', expect.anything())
  })
})
