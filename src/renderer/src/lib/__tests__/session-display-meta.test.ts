import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const setRunState = vi.fn()
const toastWarning = vi.fn()

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      historySessionFile: '/proj/sessions/a.jsonl',
      lastModel: 'anthropic/claude-from-last',
      lastThinking: 'low',
      runState: { model: 'jsonl/stale-display', thinkingLevel: 'medium' },
      setRunState,
    }),
  },
}))

vi.mock('sonner', () => ({
  toast: { warning: (...args: unknown[]) => toastWarning(...args) },
}))

vi.mock('@renderer/lib/session-worker-sync', () => ({
  isViewingWorkerBoundSession: (view: string | null | undefined, worker: string | null | undefined) =>
    !!view && !!worker && view === worker,
}))

import {
  applyComposerDisplayMeta,
  applyWorkerBoundModelDisplay,
  notifyModelFallback,
} from '../session-display-meta'

describe('session-display-meta model authority', () => {
  beforeEach(() => {
    invoke.mockReset()
    setRunState.mockReset()
    toastWarning.mockReset()
  })

  it('when worker bound to view, uses runtime model and ignores JSONL meta', async () => {
    invoke.mockResolvedValue({
      state: {
        sessionFile: '/proj/sessions/a.jsonl',
        model: 'openai/gpt-5.6-terra',
        thinkingLevel: 'high',
      },
    })

    await applyComposerDisplayMeta({
      model: 'anthropic/claude-from-jsonl',
      thinkingLevel: 'off',
    })

    expect(setRunState).toHaveBeenCalledWith({
      model: 'openai/gpt-5.6-terra',
      thinkingLevel: 'high',
    })
  })

  it('when worker bound but model empty, clears stale display model', async () => {
    invoke.mockResolvedValue({
      state: {
        sessionFile: '/proj/sessions/a.jsonl',
        model: undefined,
        thinkingLevel: 'medium',
      },
    })
    invoke.mockImplementation(async (method: string) => {
      if (method === 'ipc:runtime.getState') {
        return {
          state: {
            sessionFile: '/proj/sessions/a.jsonl',
            thinkingLevel: 'medium',
          },
        }
      }
      if (method === 'pi.settings.get') {
        return { settings: { defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-8' } }
      }
      return {}
    })

    await applyComposerDisplayMeta({ model: 'anthropic/claude-from-jsonl' })

    expect(setRunState).toHaveBeenCalledWith(
      expect.objectContaining({
        model: undefined,
        thinkingLevel: 'medium',
      }),
    )
  })

  it('when unbound preview, keeps JSONL meta for display', async () => {
    invoke.mockImplementation(async (method: string) => {
      if (method === 'ipc:runtime.getState') {
        return { state: { sessionFile: '/other/session.jsonl', model: 'other/model' } }
      }
      if (method === 'pi.settings.get') return { settings: {} }
      return {}
    })

    await applyComposerDisplayMeta({
      model: 'custom/gpt-5.6-terra',
      thinkingLevel: 'low',
    })

    expect(setRunState).toHaveBeenCalledWith({
      model: 'custom/gpt-5.6-terra',
      thinkingLevel: 'low',
    })
  })

  it('applyWorkerBoundModelDisplay updates model and toasts fallback', () => {
    applyWorkerBoundModelDisplay({
      model: 'anthropic/claude-opus-4-8',
      thinkingLevel: 'high',
      modelFallbackMessage: 'Could not restore model custom/gpt-5.6-terra. Using anthropic/claude-opus-4-8',
    })

    expect(setRunState).toHaveBeenCalledWith({
      model: 'anthropic/claude-opus-4-8',
      thinkingLevel: 'high',
    })
    expect(toastWarning).toHaveBeenCalled()
  })

  it('notifyModelFallback ignores empty', () => {
    notifyModelFallback('  ')
    expect(toastWarning).not.toHaveBeenCalled()
  })
})
