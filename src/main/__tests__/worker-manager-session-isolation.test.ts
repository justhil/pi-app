import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import { WorkerManager } from '../worker-manager'
import { attachWorkerHandlers } from '../worker-manager-pool'
import { normalizeSessionKey, workspacePoolKey } from '../worker-session-key'

vi.mock('../config-store', () => ({
  configStore: { get: vi.fn(() => undefined) },
}))

const { forkWorkerForCwd, readMaxSessionWorkers } = vi.hoisted(() => ({
  forkWorkerForCwd: vi.fn(),
  readMaxSessionWorkers: vi.fn(() => 4),
}))

vi.mock('../worker-pool-config', () => ({
  readMaxSessionWorkers,
  readSessionWorkerIdleTimeoutMinutes: vi.fn(() => 0),
}))

vi.mock('../worker-manager-pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worker-manager-pool')>()
  return { ...actual, forkWorkerForCwd }
})

type FakeTransport = WorkerSlot['worker'] & {
  postMessage: ReturnType<typeof vi.fn>
  emitMessage: (message: Record<string, unknown>) => void
}

type Internals = {
  pool: Map<string, WorkerSlot>
  foregroundPoolKey: string | null
}

function fakeSlot(poolKey: string, active = false): WorkerSlot {
  let onMessage: Parameters<WorkerSlot['worker']['onMessage']>[0] | null = null
  const worker: FakeTransport = {
    kind: 'utilityProcess',
    postMessage: vi.fn((_message: Record<string, unknown>) => {}),
    onMessage: (callback) => {
      onMessage = callback
    },
    onExit: vi.fn(),
    onStdout: vi.fn(),
    onStderr: vi.fn(),
    kill: vi.fn(),
    emitMessage: (message) => onMessage?.(message as never),
  }
  return {
    poolKey,
    cwd: '/workspace',
    runtime: { mode: 'host', distro: null },
    sessionFile: poolKey.startsWith('ws:') ? null : poolKey,
    worker,
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: active,
    lastIdleAt: Date.now(),
    lastForegroundAt: Date.now(),
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

function replyFrom(slot: WorkerSlot, reply: Record<string, unknown>): void {
  const worker = slot.worker as FakeTransport
  attachWorkerHandlers(slot, worker, {
    mainWindow: null,
    onAppEvent: vi.fn(),
    onSlotExit: vi.fn(),
  })
  worker.postMessage.mockImplementation((message: { requestId?: string }) => {
    queueMicrotask(() => worker.emitMessage({ requestId: message.requestId, ...reply }))
  })
}

function managerWithForeground(slot: WorkerSlot): { manager: WorkerManager; internals: Internals } {
  const manager = new WorkerManager()
  const internals = manager as unknown as Internals
  internals.pool.set(slot.poolKey, slot)
  internals.foregroundPoolKey = slot.poolKey
  return { manager, internals }
}

describe('WorkerManager session isolation', () => {
  beforeEach(() => {
    forkWorkerForCwd.mockReset()
    readMaxSessionWorkers.mockReturnValue(4)
  })

  it('queries context only from the worker bound to the requested session', async () => {
    const foreground = fakeSlot(normalizeSessionKey('/sessions/a.jsonl'))
    const target = fakeSlot(normalizeSessionKey('/sessions/b.jsonl'))
    const { manager, internals } = managerWithForeground(foreground)
    internals.pool.set(target.poolKey, target)
    replyFrom(foreground, { type: 'getSessionContextPreview-done', preview: { estimatedChars: 11 } })
    replyFrom(target, { type: 'getSessionContextPreview-done', preview: { estimatedChars: 22 } })

    const preview = await manager.getSessionContextPreview(target.poolKey)

    expect(preview).toEqual(expect.objectContaining({ sessionFile: target.poolKey, estimatedChars: 22 }))
    expect(foreground.worker.postMessage).not.toHaveBeenCalled()
    expect(await manager.getSessionContextPreview('/sessions/missing.jsonl')).toBeNull()
  })

  it('creates a separate worker when the foreground session is running', async () => {
    const running = fakeSlot(normalizeSessionKey('/sessions/running.jsonl'), true)
    const { manager, internals } = managerWithForeground(running)
    const created = fakeSlot(workspacePoolKey('/workspace'))
    const createdFile = normalizeSessionKey('/sessions/new.jsonl')
    replyFrom(created, { type: 'newSession-done', sessionId: 'new', sessionFile: createdFile })
    forkWorkerForCwd.mockResolvedValue({ slot: created, init: Promise.resolve({ sessionId: 'temp' }) })

    expect(await manager.newSession('/workspace')).toEqual({ sessionId: 'new', sessionFile: createdFile })
    expect(running.worker.postMessage).not.toHaveBeenCalled()
    expect(internals.pool.get(running.poolKey)).toBe(running)
    expect(internals.pool.get(createdFile)).toBe(created)
  })

  it('evicts an idle slot before forking when the pool is at capacity', async () => {
    readMaxSessionWorkers.mockReturnValue(1)
    const idle = fakeSlot(normalizeSessionKey('/sessions/idle.jsonl'))
    idle.sessionFile = null
    idle.cwd = '/other'
    const { manager, internals } = managerWithForeground(idle)
    const created = fakeSlot(workspacePoolKey('/workspace'))
    const createdFile = normalizeSessionKey('/sessions/new.jsonl')
    replyFrom(created, { type: 'newSession-done', sessionId: 'new', sessionFile: createdFile })
    forkWorkerForCwd.mockImplementation(async () => {
      expect(internals.pool.size).toBe(0)
      return { slot: created, init: Promise.resolve({ sessionId: 'temp' }) }
    })

    await expect(manager.newSession('/workspace')).resolves.toEqual({
      sessionId: 'new',
      sessionFile: createdFile,
    })
    expect(internals.pool.has(idle.poolKey)).toBe(false)
    expect(idle.worker.kill).toHaveBeenCalled()
  })

  it('keeps both slots when new sessions are created concurrently', async () => {
    const { manager, internals } = managerWithForeground(
      fakeSlot(normalizeSessionKey('/sessions/running.jsonl'), true),
    )
    let sequence = 0
    forkWorkerForCwd.mockImplementation(async (_cwd: string, options?: { poolKey?: string }) => {
      const index = ++sequence
      const slot = fakeSlot(options?.poolKey || workspacePoolKey('/workspace'))
      replyFrom(slot, {
        type: 'newSession-done',
        sessionId: `new-${index}`,
        sessionFile: normalizeSessionKey(`/sessions/new-${index}.jsonl`),
      })
      return { slot, init: Promise.resolve({ sessionId: `temp-${index}` }) }
    })

    const results = await Promise.all([manager.newSession('/workspace'), manager.newSession('/workspace')])

    expect(results.map((result) => result.sessionId)).toEqual(['new-1', 'new-2'])
    expect(internals.pool.has(normalizeSessionKey('/sessions/new-1.jsonl'))).toBe(true)
    expect(internals.pool.has(normalizeSessionKey('/sessions/new-2.jsonl'))).toBe(true)
  })

  it('sends abort only to the worker bound to the requested session', async () => {
    const foreground = fakeSlot(normalizeSessionKey('/sessions/a.jsonl'), true)
    const requested = fakeSlot(normalizeSessionKey('/sessions/b.jsonl'), true)
    const { manager, internals } = managerWithForeground(foreground)
    internals.pool.set(requested.poolKey, requested)
    replyFrom(requested, { type: 'abort-done' })

    await manager.abort(requested.poolKey)

    expect(foreground.worker.postMessage).not.toHaveBeenCalled()
    expect(requested.worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'abort', sessionFile: requested.poolKey }),
    )
  })
})
