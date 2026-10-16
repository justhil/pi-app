import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const store = {
  currentWorkspace: 'D:/workspace',
  currentSessionId: '__pending_new__',
  historySessionFile: null as string | null,
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
import { beginSessionNavigation } from './session-navigation'

describe('new session model preselection', () => {
  beforeEach(() => {
    invoke.mockReset()
    store.currentWorkspace = 'D:/workspace'
    store.currentSessionId = '__pending_new__'
    store.historySessionFile = null
    store.clearPendingNewSessionPlaceholder.mockReset()
    store.setCurrentSession.mockReset()
    store.clearFileChanges.mockReset()
    store.setHistoryMeta.mockReset()
    store.setSessions.mockReset()
  })

  it('binds the created session before model confirmation completes', async () => {
    let confirmModel: ((value: { modelId: string }) => void) | undefined
    const onSessionCreated = vi.fn()
    invoke.mockImplementation((method: string) => {
      if (method === 'session.new') {
        return Promise.resolve({ session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } })
      }
      if (method === 'session.setPendingBind') return Promise.resolve({ ok: true })
      if (method === 'model.set') return new Promise((resolve) => { confirmModel = resolve })
      if (method === 'thinkingLevel.set') return Promise.resolve({ ok: true })
      if (method === 'session.list') return Promise.resolve({ sessions: [] })
      return Promise.resolve({})
    })

    const materialized = materializePendingNewSession('D:/workspace', 'first prompt', onSessionCreated)
    await vi.waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith('C:/sessions/new.jsonl'))
    expect(confirmModel).toBeDefined()

    confirmModel?.({ modelId: 'openai/org/model/v2' })
    await expect(materialized).resolves.toBe('C:/sessions/new.jsonl')
  })

  it.each([false, true])('keeps navigation intact when creation returns after switching away (returned: %s)', async (returned) => {
    let finishCreation!: (value: unknown) => void
    const onSessionCreated = vi.fn()
    invoke.mockImplementation(async (method: string) => {
      if (method === 'session.new') return new Promise((resolve) => { finishCreation = resolve })
      if (method === 'model.set') return { modelId: 'openai/org/model/v2' }
      if (method === 'session.list') return { sessions: [] }
      return { ok: true }
    })

    const materialized = materializePendingNewSession('D:/workspace', 'first prompt', onSessionCreated)
    beginSessionNavigation()
    store.currentSessionId = 'other'
    store.historySessionFile = 'C:/sessions/other.jsonl'
    if (returned) {
      beginSessionNavigation()
      store.currentSessionId = '__pending_new__'
      store.historySessionFile = null
    }
    finishCreation({ session: { sessionId: 'new-id', sessionFile: 'C:/sessions/new.jsonl' } })

    await expect(materialized).resolves.toBe('C:/sessions/new.jsonl')
    expect(onSessionCreated).toHaveBeenCalledWith('C:/sessions/new.jsonl')
    expect(store.setCurrentSession).not.toHaveBeenCalled()
    expect(store.setHistoryMeta).not.toHaveBeenCalled()
    expect(store.clearPendingNewSessionPlaceholder).not.toHaveBeenCalled()
    expect(store.clearFileChanges).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('session.setPendingBind', expect.anything())
    expect(invoke).toHaveBeenCalledWith('model.set', expect.objectContaining({ sessionFile: 'C:/sessions/new.jsonl' }))
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

  it('rejects creation without a session file before changing the selected session', async () => {
    invoke.mockResolvedValue({ session: { sessionId: 'new-id' } })

    await expect(materializePendingNewSession('D:/workspace', 'first prompt')).rejects.toThrow(
      'session.new returned no sessionFile',
    )
    expect(store.setCurrentSession).not.toHaveBeenCalled()
    expect(store.setHistoryMeta).not.toHaveBeenCalled()
  })
})
