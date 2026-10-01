import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('../config-store', () => ({ configStore: { get: vi.fn(() => undefined) } }))
vi.mock('../session-file-meta', () => ({
  readSessionMetaFromFile: vi.fn(async () => ({ cwd: '/workspace', sessionId: 'a' })),
  sessionFilePathForFs: (file: string) => file,
}))
vi.mock('../wsl/runtime-config', () => ({
  getAgentRuntimeConfig: () => ({ mode: 'host', distro: null }),
  isWslRuntimeActive: () => false,
}))
vi.mock('../worker-pool-config', () => ({
  readMaxSessionWorkers: () => 4,
  readSessionWorkerIdleTimeoutMinutes: () => 0,
}))
vi.mock('../worker-manager-pool', async (original) => ({
  ...(await original<typeof import('../worker-manager-pool')>()),
  forkWorkerForCwd: mocks.fork,
}))

import { WorkerManager } from '../worker-manager'
import { attachWorkerHandlers, disposeWorkerSlot } from '../worker-manager-pool'
import { normalizeSessionKey } from '../worker-session-key'

type Message = Record<string, unknown>
type Handler = (message: Message, reply: (response: Message) => void) => void
type Internals = { pool: Map<string, WorkerSlot>; foregroundPoolKey: string | null }

const key = (file: string) => normalizeSessionKey(file)

function makeSlot(file: string | null, handler: Handler, poolKey = file ? key(file) : 'ws:/workspace'): WorkerSlot {
  let listener: (message: Message) => void = () => {}
  const slot: WorkerSlot = {
    poolKey,
    cwd: '/workspace',
    sessionFile: file ? key(file) : null,
    runtime: { mode: 'host', distro: null },
    worker: {
      kind: 'utilityProcess',
      postMessage: vi.fn((message: Message) => handler(message, (response) => queueMicrotask(() => listener(response)))),
      onMessage: (cb) => {
        listener = cb as (message: Message) => void
      },
      onExit: vi.fn(),
      onStdout: vi.fn(),
      onStderr: vi.fn(),
      kill: vi.fn(),
    },
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
    lastIdleAt: Date.now(),
    lastForegroundAt: Date.now(),
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
  attachWorkerHandlers(slot, slot.worker, { mainWindow: null, onAppEvent: vi.fn(), onSlotExit: vi.fn() })
  return slot
}

function setup(...slots: WorkerSlot[]) {
  const manager = new WorkerManager()
  const state = manager as unknown as Internals
  slots.forEach((slot) => state.pool.set(slot.poolKey, slot))
  state.foregroundPoolKey = slots[0]?.poolKey ?? null
  return { manager, state }
}

const normalReply: Handler = (message, reply) => {
  reply({ requestId: message.requestId, type: `${message.type}-done`, state: { sessionId: 'a' }, items: [] })
}

const posted = (slot: WorkerSlot, type: string) =>
  (slot.worker.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(([message]) => (message as Message).type === type)

beforeEach(() => {
  mocks.fork.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('R2 fork/clone remap the source worker', () => {
  it.each(['fork', 'clone'] as const)('should_remap_source_slot_when_foreground_changes_during_%s', async (action) => {
    // Given: A is running fork/clone while the user focuses B
    let finish!: () => void
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      if (message.type === action) {
        finish = () => reply({ requestId: message.requestId, type: `${action}-done`, sessionId: 'c', sessionFile: '/sessions/c.jsonl' })
      } else normalReply(message, reply)
    })
    const b = makeSlot('/sessions/b.jsonl', normalReply)
    const { manager, state } = setup(a, b)
    const pending = action === 'fork'
      ? manager.forkSession({ sessionFile: a.sessionFile!, entryId: 'entry' })
      : manager.cloneSession({ sessionFile: a.sessionFile! })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    manager.focusExistingSession(b.sessionFile!)

    // When: the source worker returns the new session C
    finish()
    await expect(pending).resolves.toMatchObject({ sessionFile: '/sessions/c.jsonl' })

    // Then: only A is re-keyed to C; B stays foreground under its own identity
    expect(state.pool.get(key('/sessions/c.jsonl'))).toBe(a)
    expect(a.sessionFile).toBe(key('/sessions/c.jsonl'))
    expect(state.pool.has(key('/sessions/a.jsonl'))).toBe(false)
    expect(state.pool.get(key('/sessions/b.jsonl'))).toBe(b)
    expect(b.sessionFile).toBe(key('/sessions/b.jsonl'))
    expect(state.foregroundPoolKey).toBe(key('/sessions/b.jsonl'))
  })

  it('should_move_foreground_to_new_session_when_source_is_still_foreground', async () => {
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      if (message.type === 'fork') reply({ requestId: message.requestId, type: 'fork-done', sessionId: 'c', sessionFile: '/sessions/c.jsonl' })
      else normalReply(message, reply)
    })
    const { manager, state } = setup(a)
    await manager.forkSession({ sessionFile: a.sessionFile!, entryId: 'entry' })
    expect(state.foregroundPoolKey).toBe(key('/sessions/c.jsonl'))
    expect(state.pool.get(key('/sessions/c.jsonl'))).toBe(a)
  })

  it('should_not_reuse_source_slot_for_another_session_when_fork_is_in_flight', async () => {
    let finish!: () => void
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      if (message.type === 'fork') finish = () => reply({ requestId: message.requestId, type: 'fork-done', sessionId: 'c', sessionFile: '/sessions/c.jsonl' })
      else normalReply(message, reply)
    })
    const { manager, state } = setup(a)
    mocks.fork.mockImplementation(async (_cwd: string, options?: { poolKey: string }) => ({
      slot: makeSlot(options!.poolKey, normalReply),
      init: Promise.resolve({ sessionId: 'd' }),
    }))
    const pending = manager.forkSession({ sessionFile: a.sessionFile!, entryId: 'entry' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await manager.ensureSessionWorker('/sessions/d.jsonl', '/workspace')
    finish()
    await pending
    expect(posted(a, 'loadSession').every(([message]) => (message as Message).sessionFile !== key('/sessions/d.jsonl'))).toBe(true)
    expect(state.pool.get(key('/sessions/c.jsonl'))).toBe(a)
    expect(state.pool.get(key('/sessions/d.jsonl'))).not.toBe(a)
  })
})

describe('R1 session binding commits only after a successful load', () => {
  it('should_keep_original_identity_when_reused_worker_cancels_switch', async () => {
    // Given: idle worker A is reusable for B, but the extension cancels the switch
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      if (message.type === 'loadSession') reply({ requestId: message.requestId, type: 'error', error: 'SESSION_SWITCH_CANCELLED' })
      else normalReply(message, reply)
    })
    const { manager, state } = setup(a)

    // When / Then: the error reaches the caller and A keeps its binding
    await expect(manager.ensureSessionWorker('/sessions/b.jsonl', '/workspace')).rejects.toThrow('SESSION_SWITCH_CANCELLED')
    expect(state.pool.get(key('/sessions/a.jsonl'))).toBe(a)
    expect(state.pool.has(key('/sessions/b.jsonl'))).toBe(false)
    expect(a.poolKey).toBe(key('/sessions/a.jsonl'))
    expect(a.sessionFile).toBe(key('/sessions/a.jsonl'))
    expect(state.foregroundPoolKey).toBe(key('/sessions/a.jsonl'))
  })

  it('should_commit_new_identity_and_foreground_when_reused_worker_loads', async () => {
    const a = makeSlot('/sessions/a.jsonl', normalReply)
    const { manager, state } = setup(a)
    await manager.ensureSessionWorker('/sessions/b.jsonl', '/workspace')
    expect(state.pool.get(key('/sessions/b.jsonl'))).toBe(a)
    expect(state.pool.has(key('/sessions/a.jsonl'))).toBe(false)
    expect(a.sessionFile).toBe(key('/sessions/b.jsonl'))
    expect(state.foregroundPoolKey).toBe(key('/sessions/b.jsonl'))
  })

  it('should_propagate_error_when_existing_slot_fails_to_load', async () => {
    const b = makeSlot('/sessions/b.jsonl', (message, reply) => {
      if (message.type === 'loadSession') reply({ requestId: message.requestId, type: 'error', error: 'loadSession failed: boom' })
      else normalReply(message, reply)
    })
    const { manager, state } = setup(b)
    await expect(manager.ensureSessionWorker('/sessions/b.jsonl', '/workspace')).rejects.toThrow('boom')
    expect(state.pool.get(key('/sessions/b.jsonl'))).toBe(b)
  })

  it('should_remove_and_dispose_new_worker_when_initial_load_fails', async () => {
    vi.useFakeTimers()
    const created: WorkerSlot[] = []
    mocks.fork.mockImplementation(async (_cwd: string, options?: { poolKey: string }) => {
      const slot = makeSlot(options!.poolKey, (message, reply) => {
        if (message.type === 'loadSession') reply({ requestId: message.requestId, type: 'error', error: 'loadSession failed: bad file' })
        else normalReply(message, reply)
      })
      created.push(slot)
      return { slot, init: Promise.resolve({ sessionId: 'b' }) }
    })
    const { manager, state } = setup()
    const failed = manager.ensureSessionWorker('/sessions/b.jsonl', '/workspace').catch((error: Error) => error)
    await vi.runAllTimersAsync()
    expect((await failed as Error).message).toContain('bad file')
    expect(state.pool.size).toBe(0)
    expect(created[0].stopping).toBe(true)
    expect(created[0].worker.kill).toHaveBeenCalledOnce()
  })
})

describe('R5 lazy RPC acquisition goes through the lifecycle queue', () => {
  it('should_fork_one_worker_when_cold_session_receives_parallel_rpcs', async () => {
    const workers: WorkerSlot[] = []
    mocks.fork.mockImplementation(async (_cwd: string, options?: { poolKey: string }) => {
      await Promise.resolve()
      const slot = makeSlot(options!.poolKey, normalReply)
      workers.push(slot)
      return { slot, init: Promise.resolve({ sessionId: 'a' }) }
    })
    const { manager, state } = setup()
    await Promise.all([
      manager.setModel('provider', 'model', '/sessions/a.jsonl'),
      manager.setThinkingLevel('medium', '/sessions/a.jsonl'),
    ])
    expect(mocks.fork).toHaveBeenCalledTimes(1)
    expect(state.pool.size).toBe(1)
    expect(posted(workers[0], 'setModel')).toHaveLength(1)
    expect(posted(workers[0], 'setThinkingLevel')).toHaveLength(1)
  })

  it('should_retry_creation_when_previous_lazy_fork_failed', async () => {
    mocks.fork.mockRejectedValueOnce(new Error('fork failed'))
    mocks.fork.mockImplementation(async (_cwd: string, options?: { poolKey: string }) => ({
      slot: makeSlot(options!.poolKey, normalReply),
      init: Promise.resolve({ sessionId: 'a' }),
    }))
    const { manager, state } = setup()
    await expect(manager.setModel('provider', 'model', '/sessions/a.jsonl')).rejects.toThrow('fork failed')
    expect(state.pool.size).toBe(0)
    await manager.setModel('provider', 'model', '/sessions/a.jsonl')
    expect(mocks.fork).toHaveBeenCalledTimes(2)
    expect(state.pool.size).toBe(1)
  })
})

describe('R4 deleting sessions keeps pool identity truthful', () => {
  it('should_rebind_slot_to_worker_new_session_when_bound_session_is_deleted', async () => {
    // Given: A is bound; the worker deletes it and rebuilds a fresh session
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      if (message.type === 'sessionDeleteFile') {
        reply({ requestId: message.requestId, type: 'sessionDeleteFile-done', ok: true, sessionId: 'new', sessionFile: '/sessions/new.jsonl' })
      } else reply({ requestId: message.requestId, type: 'getState-done', state: { sessionFile: '/sessions/new.jsonl', sessionId: 'new' } })
    })
    const { manager, state } = setup(a)

    // When
    await expect(manager.deleteSessionFile(a.sessionFile!)).resolves.toEqual({ ok: true, error: undefined })

    // Then: the deleted file is no longer bound and the slot reports its real session
    expect(state.pool.has(key('/sessions/a.jsonl'))).toBe(false)
    expect(state.pool.get(key('/sessions/new.jsonl'))).toBe(a)
    expect(state.foregroundPoolKey).toBe(key('/sessions/new.jsonl'))
    expect(await manager.getState('/sessions/a.jsonl')).toMatchObject({ bound: false })
    expect(await manager.getState('/sessions/new.jsonl')).toMatchObject({ sessionId: 'new', sessionFile: key('/sessions/new.jsonl'), bound: true })
  })

  it('should_unbind_slot_when_worker_has_no_replacement_session', async () => {
    const a = makeSlot('/sessions/a.jsonl', (message, reply) => {
      reply({ requestId: message.requestId, type: 'sessionDeleteFile-done', ok: true, sessionFile: null })
    })
    const { manager, state } = setup(a)
    await manager.deleteSessionFile(a.sessionFile!)
    expect(state.pool.has(key('/sessions/a.jsonl'))).toBe(false)
    expect(a.sessionFile).toBeNull()
    expect(state.pool.get(a.poolKey)).toBe(a)
    expect(state.foregroundPoolKey).toBe(a.poolKey)
  })

  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-delete-'))
    dirs.push(dir)
    return dir
  }

  it('should_delete_offline_file_without_starting_worker_when_session_is_unbound', async () => {
    const file = join(tempDir(), 'offline.jsonl')
    writeFileSync(file, '{"type":"session","id":"x","cwd":"/workspace"}\n')
    const other = makeSlot('/sessions/other.jsonl', normalReply)
    const { manager, state } = setup(other)
    await expect(manager.deleteSessionFile(file)).resolves.toEqual({ ok: true })
    expect(existsSync(file)).toBe(false)
    expect(mocks.fork).not.toHaveBeenCalled()
    expect(posted(other, 'sessionDeleteFile')).toHaveLength(0)
    expect(state.pool.size).toBe(1)
  })

  it('should_report_failure_when_offline_unlink_fails', async () => {
    const notAFile = join(tempDir(), 'dir.jsonl')
    mkdirSync(notAFile)
    const { manager } = setup()
    await expect(manager.deleteSessionFile(notAFile)).resolves.toMatchObject({ ok: false, error: expect.any(String) })
    expect(existsSync(notAFile)).toBe(true)
  })

  it('should_treat_missing_offline_file_as_deleted', async () => {
    const { manager } = setup()
    await expect(manager.deleteSessionFile(join(tempDir(), 'missing.jsonl'))).resolves.toEqual({ ok: true })
    expect(mocks.fork).not.toHaveBeenCalled()
  })
})

describe('R7 stopping an unresponsive worker', () => {
  it('should_kill_within_short_deadline_when_worker_ignores_abort', async () => {
    vi.useFakeTimers()
    const slot = makeSlot('/sessions/a.jsonl', () => {})
    const stopping = disposeWorkerSlot(slot)
    await vi.advanceTimersByTimeAsync(5_000)
    await stopping
    expect(slot.worker.kill).toHaveBeenCalledOnce()
    expect(slot.pendingRequests.size).toBe(0)
  })

  it('should_keep_flush_window_and_order_when_worker_answers_abort', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const slot = makeSlot('/sessions/a.jsonl', (message, reply) => {
      order.push(String(message.type))
      if (message.type === 'abort') reply({ requestId: message.requestId, type: 'abort-done' })
    })
    ;(slot.worker.kill as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('kill'))
    const stopping = disposeWorkerSlot(slot)
    await vi.advanceTimersByTimeAsync(300)
    expect(slot.worker.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    await stopping
    expect(order).toEqual(['abort', 'dispose', 'kill'])
  })
})
