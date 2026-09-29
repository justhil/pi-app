import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const setRunState = vi.fn()
const toastWarning = vi.fn()
const view = vi.hoisted(() => ({ historySessionFile: '/proj/sessions/a.jsonl' as string | null }))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => invoke(...args) },
}))

vi.mock('@renderer/stores/ui-store', () => ({
  useUIStore: {
    getState: () => ({
      historySessionFile: view.historySessionFile,
      sessions: [],
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
  forgetSessionDisplayMeta,
  notifyModelFallback,
} from '../session-display-meta'

describe('session-display-meta model authority', () => {
  beforeEach(() => {
    invoke.mockReset()
    setRunState.mockReset()
    toastWarning.mockReset()
    forgetSessionDisplayMeta()
    view.historySessionFile = '/proj/sessions/a.jsonl'
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  // Switching sessions fires a meta-less refresh (composer effect) and then the hydrate's
  // JSONL-meta refresh; whichever IPC round-trip finished last used to win.
  it('lets the newest refresh win even when an older one resolves later', async () => {
    // Older meta-less refresh reads runtime state first, then stalls on pi defaults while the
    // newer JSONL-meta refresh completes; its late default-model write must not land.
    const olderDefaults = deferred<unknown>()
    let settingsCalls = 0
    invoke.mockImplementation(async (method: string, req?: { sessionFile?: string }) => {
      if (method === 'ipc:runtime.getState') {
        return { state: { sessionFile: req?.sessionFile, bound: false } }
      }
      if (method === 'pi.settings.get') {
        settingsCalls += 1
        const defaults = { settings: { defaultProvider: 'anthropic', defaultModel: 'claude-default' } }
        return settingsCalls === 1 ? olderDefaults.promise.then(() => defaults) : defaults
      }
      return {}
    })

    const older = applyComposerDisplayMeta()
    await vi.waitFor(() => expect(settingsCalls).toBe(1))
    await applyComposerDisplayMeta({ model: 'openai-codex/gpt-5.5', thinkingLevel: 'high' })
    olderDefaults.resolve(undefined)
    await older

    expect(setRunState).toHaveBeenLastCalledWith({
      model: 'openai-codex/gpt-5.5',
      thinkingLevel: 'high',
    })
  })

  it('drops a refresh whose session was switched away mid-flight', async () => {
    const state = deferred<unknown>()
    invoke.mockImplementation(async (method: string) => {
      if (method === 'ipc:runtime.getState') return state.promise
      return { settings: {} }
    })

    const pending = applyComposerDisplayMeta({ model: 'openai/from-session-a' })
    view.historySessionFile = '/proj/sessions/b.jsonl'
    state.resolve({ state: { sessionFile: '/proj/sessions/a.jsonl', bound: false } })
    await pending

    expect(setRunState).not.toHaveBeenCalled()
  })

  // #100: returning from Settings refreshes without meta; the foreground worker may belong to
  // another session (e.g. Settings started the workspace worker).
  it('queries the viewed session worker, not the foreground worker', async () => {
    invoke.mockImplementation(async (method: string, req?: { sessionFile?: string }) => {
      if (method === 'ipc:runtime.getState') {
        if (req?.sessionFile === '/proj/sessions/a.jsonl') {
          return {
            state: {
              sessionFile: '/proj/sessions/a.jsonl',
              model: 'openai-codex/gpt-5.5',
              thinkingLevel: 'high',
              bound: true,
            },
          }
        }
        return { state: { sessionFile: '/proj/sessions/other.jsonl', model: 'anthropic/claude-default' } }
      }
      if (method === 'pi.settings.get') {
        return { settings: { defaultProvider: 'anthropic', defaultModel: 'claude-default' } }
      }
      return {}
    })

    await applyComposerDisplayMeta()

    expect(setRunState).toHaveBeenLastCalledWith({
      model: 'openai-codex/gpt-5.5',
      thinkingLevel: 'high',
    })
  })

  it('keeps the session model learned from JSONL when a later refresh has no meta', async () => {
    invoke.mockImplementation(async (method: string, req?: { sessionFile?: string }) => {
      if (method === 'ipc:runtime.getState') {
        // No worker slot for the viewed session yet (lazy bind).
        return { state: { sessionFile: req?.sessionFile, isStreaming: false, bound: false } }
      }
      if (method === 'pi.settings.get') {
        return { settings: { defaultProvider: 'anthropic', defaultModel: 'claude-default' } }
      }
      return {}
    })

    await applyComposerDisplayMeta({ model: 'openai-codex/gpt-5.5', thinkingLevel: 'high' })
    await applyComposerDisplayMeta()

    expect(setRunState).toHaveBeenLastCalledWith({
      model: 'openai-codex/gpt-5.5',
      thinkingLevel: 'high',
    })
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
