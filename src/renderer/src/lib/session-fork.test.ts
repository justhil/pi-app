import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue({}),
  openSessionIntoWorker: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
vi.mock('@renderer/lib/open-session', () => ({ openSessionIntoWorker: mocks.openSessionIntoWorker }))
vi.mock('@renderer/lib/composer-run-display', () => ({ refreshComposerRunDisplay: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import { cloneCurrentSession, forkSessionFromEntry } from './session-fork'

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({
    currentWorkspace: '/workspace',
    currentSessionId: 'source-session',
    historySessionFile: '/sessions/source.jsonl',
    sessions: [],
    composerPrefill: 'existing draft',
    runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
    streamingAssistantId: null,
    optimisticPendingUserText: null,
    sessionRuntimeRunning: {},
    agentTurnBootstrapping: false,
    subagentSessionGroup: null,
  })
})

describe('session fork renderer actions', () => {
  it('auto-opens the fork and prefills the original user text', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.fork') {
        return {
          cancelled: false,
          sessionId: 'fork-session',
          sessionFile: '/sessions/fork.jsonl',
          editorText: 'original prompt',
        }
      }
      if (channel === 'session.list') return { sessions: [] }
      return {}
    })

    await expect(forkSessionFromEntry('user-entry')).resolves.toBe(true)

    expect(mocks.invoke).toHaveBeenCalledWith('session.fork', expect.objectContaining({
      sessionFile: '/sessions/source.jsonl',
      entryId: 'user-entry',
      position: 'before',
    }))
    expect(mocks.openSessionIntoWorker).toHaveBeenCalledWith(
      'fork-session',
      '/sessions/fork.jsonl',
    )
    expect(useUIStore.getState().composerPrefill).toBe('original prompt')
  })

  it('auto-opens the clone and clears composer prefill', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.clone') {
        return {
          cancelled: false,
          sessionId: 'clone-session',
          sessionFile: '/sessions/clone.jsonl',
        }
      }
      if (channel === 'session.list') return { sessions: [] }
      return {}
    })

    await expect(cloneCurrentSession()).resolves.toBe(true)

    expect(mocks.openSessionIntoWorker).toHaveBeenCalledWith(
      'clone-session',
      '/sessions/clone.jsonl',
    )
    expect(useUIStore.getState().composerPrefill).toBeNull()
  })

  it('should_block_branch_mutations_in_read_only_subagent_preview', async () => {
    useUIStore.setState({
      currentSessionId: 'child-session',
      historySessionFile: '/sessions/child.jsonl',
      subagentSessionGroup: {
        workspacePath: '/workspace',
        parentSessionId: 'source-session',
        parentSessionFile: '/sessions/source.jsonl',
        previewSessionFile: '/sessions/child.jsonl',
        children: [
          {
            key: 'call-1:0',
            agent: 'scout',
            state: 'completed',
            sessionFile: '/sessions/child.jsonl',
          },
        ],
      },
    })

    await expect(forkSessionFromEntry('user-entry')).resolves.toBe(false)
    await expect(cloneCurrentSession()).resolves.toBe(false)

    expect(mocks.invoke).not.toHaveBeenCalledWith('session.fork', expect.anything())
    expect(mocks.invoke).not.toHaveBeenCalledWith('session.clone', expect.anything())
  })
})
