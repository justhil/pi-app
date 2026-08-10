import { describe, expect, it, vi } from 'vitest'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import type { WorkerSlot } from '../worker-manager-types'
import { WorkerManager } from '../worker-manager'
import type { WorkerTransport } from '../worker-transport'
import {
  attachWorkerHandlers,
  canAcquireNewWorker,
  evictBackgroundWorkers,
  evictIdleWorkers,
  pruneIdleWorkersByTimeout,
  remapSessionWorkerSlot,
  rejectPendingWorkerRequests,
  slotRequest,
} from '../worker-manager-pool'
import {
  minutesToIdleDelayMs,
  normalizeMaxSessionWorkers,
  normalizeSessionWorkerIdleTimeoutMinutes,
  MAX_TIMER_DELAY_MS,
} from '../worker-pool-config'
import { normalizeSessionKey, workspacePoolKey } from '../worker-session-key'

vi.mock('../config-store', () => ({
  configStore: {
    get: vi.fn(() => undefined),
  },
}))

function makeFakeTransport(): WorkerTransport & { emitMessage: (m: WorkerResponsePayload) => void } {
  const messageListeners: Array<(m: WorkerResponsePayload) => void> = []
  return {
    kind: 'utilityProcess',
    postMessage: vi.fn(),
    onMessage: (cb) => {
      messageListeners.push(cb)
    },
    onExit: () => {},
    onStdout: () => {},
    onStderr: () => {},
    kill: () => {},
    emitMessage: (m) => {
      for (const cb of messageListeners) cb(m)
    },
  }
}

function fakeSlot(poolKey: string, cwd: string, active: boolean, lastFg = Date.now()): WorkerSlot {
  return {
    poolKey,
    cwd,
    sessionFile: poolKey.startsWith('ws:') ? null : poolKey,
    worker: {} as WorkerSlot['worker'],
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: active,
    lastIdleAt: Date.now(),
    lastForegroundAt: lastFg,
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

describe('worker-session-key', () => {
  it('should_normalize_session_paths_consistently', () => {
    const workspaceDirectory = process.cwd().replace(/\\/g, '/')
    const directPath = normalizeSessionKey(`${workspaceDirectory}/tmp/s.jsonl`)
    const redundantSegmentPath = normalizeSessionKey(
      `${workspaceDirectory}/tmp/./s.jsonl`,
    )

    expect(directPath).toBeTruthy()
    expect(redundantSegmentPath).toBe(directPath)

    if (process.platform === 'win32') {
      const lowerCaseDrivePath = `${directPath.charAt(0).toLowerCase()}${directPath.slice(1)}`
      expect(normalizeSessionKey(lowerCaseDrivePath)).toBe(directPath)
    }
  })

  it('should_prefix_workspace_pool_keys', () => {
    expect(workspacePoolKey('/w/a').startsWith('ws:')).toBe(true)
  })
})

describe('worker-pool-config', () => {
  it('should_clamp_invalid_max_workers_to_default', () => {
    expect(normalizeMaxSessionWorkers(0)).toBe(4)
    expect(normalizeMaxSessionWorkers(-1)).toBe(4)
    expect(normalizeMaxSessionWorkers(3.5)).toBe(4)
    expect(normalizeMaxSessionWorkers(8)).toBe(8)
  })

  it('should_treat_zero_idle_minutes_as_never', () => {
    expect(normalizeSessionWorkerIdleTimeoutMinutes(0)).toBe(0)
    expect(minutesToIdleDelayMs(0)).toBe(null)
  })

  it('should_not_overflow_timer_delay_ms', () => {
    const huge = Number.MAX_SAFE_INTEGER
    const ms = minutesToIdleDelayMs(huge)
    expect(ms).not.toBeNull()
    expect(ms!).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS)
  })
})

describe('evictIdleWorkers', () => {
  it('should_keep_idle_sessions_while_pool_is_within_capacity', async () => {
    vi.useFakeTimers()
    try {
      const pool = new Map<string, WorkerSlot>()
      pool.set('/s/a', fakeSlot('/s/a', '/w', false, 1))
      pool.set('/s/b', fakeSlot('/s/b', '/w', false, 2))
      pool.set('/s/c', fakeSlot('/s/c', '/w', false, 3))

      evictIdleWorkers(pool, { foregroundKey: '/s/c', maxWorkers: 4 })
      await vi.runAllTimersAsync()

      expect([...pool.keys()]).toEqual(['/s/a', '/s/b', '/s/c'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('should_keep_agentTurnActive_background_when_switching_foreground', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/s/a', fakeSlot('/s/a', '/w/a', true, 1))
    pool.set('/s/b', fakeSlot('/s/b', '/w/a', false, 2))
    evictIdleWorkers(pool, { foregroundKey: '/s/b', maxWorkers: 4 })
    expect(pool.has('/s/a')).toBe(true)
    expect(pool.has('/s/b')).toBe(true)
  })

  it('should_not_dispose_running_when_over_capacity', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/s/a', fakeSlot('/s/a', '/w', true, 1))
    pool.set('/s/b', fakeSlot('/s/b', '/w', true, 2))
    pool.set('/s/c', fakeSlot('/s/c', '/w', false, 0))
    evictIdleWorkers(pool, { foregroundKey: '/s/a', maxWorkers: 2 })
    expect(pool.has('/s/a')).toBe(true)
    expect(pool.has('/s/b')).toBe(true)
    expect(pool.has('/s/c')).toBe(false)
  })

  it('legacy_evictBackgroundWorkers_keeps_idle_slots_within_capacity', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/w/a', fakeSlot('/w/a', '/w/a', false))
    pool.set('/w/b', fakeSlot('/w/b', '/w/b', false))
    evictBackgroundWorkers(pool, '/w/b', '/w/a')
    expect(pool.has('/w/a')).toBe(true)
    expect(pool.has('/w/b')).toBe(true)
  })
})

describe('canAcquireNewWorker', () => {
  it('should_reject_when_all_slots_running_and_full', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/s/a', fakeSlot('/s/a', '/w', true))
    pool.set('/s/b', fakeSlot('/s/b', '/w', true))
    expect(canAcquireNewWorker(pool, 2).ok).toBe(false)
  })

  it('should_allow_when_idle_slot_can_be_evicted', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/s/a', fakeSlot('/s/a', '/w', true))
    pool.set('/s/b', fakeSlot('/s/b', '/w', false))
    expect(canAcquireNewWorker(pool, 2).ok).toBe(true)
  })
})

describe('pruneIdleWorkersByTimeout', () => {
  it('should_not_prune_running_slots', () => {
    const pool = new Map<string, WorkerSlot>()
    const slot = fakeSlot('/s/a', '/w', true)
    slot.lastIdleAt = 0
    pool.set('/s/a', slot)
    // With default 15min config, even old lastIdleAt should skip running
    const n = pruneIdleWorkersByTimeout(pool, null, Date.now())
    expect(n).toBe(0)
    expect(pool.has('/s/a')).toBe(true)
  })
})

describe('WorkerManager active turns', () => {
  it('reports an active turn from any worker slot', () => {
    const manager = new WorkerManager()
    const internals = manager as unknown as { pool: Map<string, WorkerSlot> }
    internals.pool.set('/s/idle', fakeSlot('/s/idle', '/w', false))
    internals.pool.set('/s/running', fakeSlot('/s/running', '/w', true))

    expect(manager.hasActiveTurns).toBe(true)

    internals.pool.get('/s/running')!.agentTurnActive = false
    expect(manager.hasActiveTurns).toBe(false)
  })
})

describe('WorkerManager listSessions routing', () => {
  function respondingSlot(poolKey: string, cwd: string): WorkerSlot {
    const transport = makeFakeTransport()
    transport.postMessage = vi.fn((message: { requestId?: string }) => {
      queueMicrotask(() => {
        transport.emitMessage({
          type: 'listSessions-done',
          requestId: message.requestId,
          sessions: [{ id: 's1', cwd }],
        } as WorkerResponsePayload)
      })
    })
    const slot = fakeSlot(poolKey, cwd, false)
    slot.worker = transport
    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: null,
      onAppEvent: vi.fn(),
      onSlotExit: vi.fn(),
    })
    return slot
  }

  it('prefers a same-cwd WSL slot over a host foreground slot', async () => {
    const manager = new WorkerManager()
    const internals = manager as unknown as {
      pool: Map<string, WorkerSlot>
      foregroundPoolKey: string | null
    }
    const wslCwd = '\\\\wsl.localhost\\Debian\\root\\proj'
    const wslSlot = respondingSlot('ws:' + wslCwd, wslCwd)
    internals.pool.set('ws:' + wslCwd, wslSlot)
    internals.pool.set('ws:C:\\host\\proj', respondingSlot('ws:C:\\host\\proj', 'C:\\host\\proj'))
    internals.foregroundPoolKey = 'ws:C:\\host\\proj'

    const rows = await manager.listSessions(wslCwd)
    expect(rows).toEqual([{ id: 's1', cwd: wslCwd }])
  })

  it('does not route a WSL target to a host worker when no WSL slot exists', async () => {
    const manager = new WorkerManager()
    const internals = manager as unknown as { pool: Map<string, WorkerSlot> }
    const hostSlot = respondingSlot('ws:C:\\host\\proj', 'C:\\host\\proj')
    internals.pool.set('ws:C:\\host\\proj', hostSlot)

    const rows = await manager.listSessions('\\\\wsl.localhost\\Debian\\root\\proj')
    expect(rows).toEqual([])
  })
})

describe('WorkerManager session-worker reuse', () => {
  function boundSlot(poolKey: string, cwd: string): WorkerSlot {
    const transport = makeFakeTransport()
    transport.postMessage = vi.fn((message: { requestId?: string }) => {
      queueMicrotask(() => {
        transport.emitMessage({
          type: 'done',
          requestId: message.requestId,
          state: { sessionFile: poolKey, isStreaming: false },
        } as WorkerResponsePayload)
      })
    })
    const slot = fakeSlot(poolKey, cwd, false)
    slot.worker = transport
    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: null,
      onAppEvent: vi.fn(),
      onSlotExit: vi.fn(),
    })
    return slot
  }

  it('reuses an idle same-cwd session worker instead of forking a new one', async () => {
    const manager = new WorkerManager()
    const internals = manager as unknown as {
      pool: Map<string, WorkerSlot>
      foregroundPoolKey: string | null
    }
    const cwd = '/w'
    const sA = normalizeSessionKey('/w/session-a.jsonl')
    const sB = normalizeSessionKey('/w/session-b.jsonl')
    const slotA = boundSlot(sA, cwd)
    internals.pool.set(sA, slotA)
    internals.foregroundPoolKey = sA

    await manager.loadSession(sB, { cwd })

    // pool 只保留一个 slot，且被 rekey 到新 session（没有 fork 新 worker）
    expect(internals.pool.size).toBe(1)
    expect(internals.pool.has(sA)).toBe(false)
    expect(internals.pool.has(sB)).toBe(true)
    expect(internals.pool.get(sB)).toBe(slotA)
    expect(internals.foregroundPoolKey).toBe(sB)
  })

  it('does not steal a same-cwd slot that is mid-turn', async () => {
    const manager = new WorkerManager()
    const internals = manager as unknown as { pool: Map<string, WorkerSlot> }
    const cwd = '/w'
    const sA = normalizeSessionKey('/w/session-a.jsonl')
    const sB = normalizeSessionKey('/w/session-b.jsonl')
    const runningA = fakeSlot(sA, cwd, true)
    internals.pool.set(sA, runningA)

    // 无空闲 slot 可复用 → 尝试 fork。此时 pool 已满且 running 不可 evict，
    // 但只验证 running slot 未被 rekey。
    await expect(manager.loadSession(sB, { cwd })).rejects.toThrow()
    expect(internals.pool.has(sA)).toBe(true)
    expect(internals.pool.has(sB)).toBe(false)
    expect(runningA.sessionFile).toBe(sA)
  })
})

describe('session-scoped RPC routing', () => {
  it('should_not_move_view_foreground_when_targeting_an_existing_background_worker', async () => {
    const manager = new WorkerManager()
    const foregroundProcess = { postMessage: vi.fn() } as unknown as WorkerSlot['worker']
    const backgroundTransport = makeFakeTransport()
    const backgroundKey = normalizeSessionKey('/s/b')
    const foregroundKey = normalizeSessionKey('/s/a')
    const foregroundSlot = fakeSlot(foregroundKey, '/w', false)
    const backgroundSlot = fakeSlot(backgroundKey, '/w', false)
    foregroundSlot.worker = foregroundProcess
    backgroundSlot.worker = backgroundTransport
    backgroundTransport.postMessage = vi.fn((message: { requestId?: string }) => {
      queueMicrotask(() => {
        backgroundTransport.emitMessage({
          type: 'queueCleared',
          requestId: message.requestId,
          steering: [],
          followUp: [],
        } as WorkerResponsePayload)
      })
    })
    attachWorkerHandlers(backgroundSlot, backgroundSlot.worker, {
      mainWindow: null,
      onAppEvent: vi.fn(),
      onSlotExit: vi.fn(),
    })

    const internals = manager as unknown as {
      pool: Map<string, WorkerSlot>
      foregroundPoolKey: string | null
    }
    internals.pool.set(foregroundKey, foregroundSlot)
    internals.pool.set(backgroundKey, backgroundSlot)
    internals.foregroundPoolKey = foregroundKey

    await manager.clearPromptQueue('/s/b')
    await manager.loadSession('/s/b', { cwd: '/w' })
    manager.respondExtensionUI({ id: 'foreground-response', confirmed: true })

    expect(foregroundProcess.postMessage).toHaveBeenCalledWith({
      type: 'extension-ui-response',
      response: { id: 'foreground-response', confirmed: true },
    })
    expect(internals.foregroundPoolKey).toBe(foregroundKey)

    expect(manager.focusExistingSession('/s/b')).toBe(true)
    expect(internals.foregroundPoolKey).toBe(backgroundKey)
  })
})

describe('session worker re-key collisions', () => {
  it('disposes and rejects a conflicting idle target before replacement', async () => {
    const sourceKey = normalizeSessionKey('/s/source')
    const targetKey = normalizeSessionKey('/s/target')
    const source = fakeSlot(sourceKey, '/w', false)
    const target = fakeSlot(targetKey, '/w', false)
    const pendingRejection = vi.fn()
    target.pendingRequests.set('pending', {
      resolve: vi.fn(),
      reject: pendingRejection,
      timer: setTimeout(() => {}, 60_000),
    })
    const pool = new Map<string, WorkerSlot>([
      [sourceKey, source],
      [targetKey, target],
    ])
    const dispose = vi.fn(async (slot: WorkerSlot) => {
      slot.stopping = true
      rejectPendingWorkerRequests(slot, new Error('Worker slot replaced'))
    })

    let foregroundKey = sourceKey
    foregroundKey = await remapSessionWorkerSlot(pool, foregroundKey, '/s/target', dispose)

    expect(dispose).toHaveBeenCalledWith(target)
    expect(pendingRejection).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Worker slot replaced' }),
    )
    expect(pool.size).toBe(1)
    expect(pool.get(targetKey)).toBe(source)
    expect(pool.has(sourceKey)).toBe(false)
    expect(source.poolKey).toBe(targetKey)
    expect(source.sessionFile).toBe(targetKey)
    expect(foregroundKey).toBe(targetKey)
  })

  it('rejects a running target collision without mutating either slot', async () => {
    const sourceKey = normalizeSessionKey('/s/source')
    const targetKey = normalizeSessionKey('/s/target')
    const source = fakeSlot(sourceKey, '/w', false)
    const target = fakeSlot(targetKey, '/w', true)
    const pool = new Map<string, WorkerSlot>([
      [sourceKey, source],
      [targetKey, target],
    ])
    const dispose = vi.fn()

    const foregroundKey = sourceKey
    await expect(
      remapSessionWorkerSlot(pool, foregroundKey, '/s/target', dispose),
    ).rejects.toThrow('SESSION_WORKER_TARGET_BUSY')

    expect(dispose).not.toHaveBeenCalled()
    expect(foregroundKey).toBe(sourceKey)
    expect(pool.get(sourceKey)).toBe(source)
    expect(pool.get(targetKey)).toBe(target)
    expect(source.poolKey).toBe(sourceKey)
    expect(source.sessionFile).toBe(sourceKey)
  })
})

describe('worker process exit', () => {
  it('should_reject_all_pending_requests_when_current_worker_exits', async () => {
    vi.useFakeTimers()
    try {
      const exitHandlers: Array<(code: number) => void> = []
      const transport: WorkerTransport = {
        kind: 'utilityProcess',
        postMessage: vi.fn(),
        onMessage: () => {},
        onExit: (cb) => {
          exitHandlers.push(cb)
        },
        onStdout: () => {},
        onStderr: () => {},
        kill: () => {},
      }
      const slot = fakeSlot('/s/a', '/w', true)
      slot.worker = transport

      attachWorkerHandlers(slot, slot.worker, {
        mainWindow: null,
        onAppEvent: vi.fn(),
        onSlotExit: vi.fn(),
      })

      const pendingRequest = slotRequest(slot, 'getState')
      const rejection = pendingRequest.catch((error: unknown) => error)
      expect(slot.pendingRequests.size).toBe(1)

      for (const cb of exitHandlers) cb(17)
      await Promise.resolve()

      expect(slot.pendingRequests.size).toBe(0)
      await expect(rejection).resolves.toEqual(
        expect.objectContaining({ message: expect.stringContaining('17') }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
