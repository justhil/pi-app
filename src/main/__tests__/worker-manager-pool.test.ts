import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import { WorkerManager } from '../worker-manager'
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

describe('session-scoped RPC routing', () => {
  it('should_not_move_view_foreground_when_targeting_an_existing_background_worker', async () => {
    const manager = new WorkerManager()
    const foregroundProcess = new EventEmitter() as EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>
      stdout?: EventEmitter
      stderr?: EventEmitter
    }
    foregroundProcess.postMessage = vi.fn()
    const backgroundProcess = new EventEmitter() as EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>
      stdout?: EventEmitter
      stderr?: EventEmitter
    }
    const foregroundKey = normalizeSessionKey('/s/a')
    const backgroundKey = normalizeSessionKey('/s/b')
    const foregroundSlot = fakeSlot(foregroundKey, '/w', false)
    const backgroundSlot = fakeSlot(backgroundKey, '/w', false)
    foregroundSlot.worker = foregroundProcess as unknown as WorkerSlot['worker']
    backgroundSlot.worker = backgroundProcess as unknown as WorkerSlot['worker']
    backgroundProcess.postMessage = vi.fn((message: { requestId?: string }) => {
      queueMicrotask(() => {
        backgroundProcess.emit('message', {
          type: 'queueCleared',
          requestId: message.requestId,
          steering: [],
          followUp: [],
        })
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
      const processEmitter = new EventEmitter() as EventEmitter & {
        postMessage: ReturnType<typeof vi.fn>
        stdout?: EventEmitter
        stderr?: EventEmitter
      }
      processEmitter.postMessage = vi.fn()
      const slot = fakeSlot('/s/a', '/w', true)
      slot.worker = processEmitter as unknown as WorkerSlot['worker']

      attachWorkerHandlers(slot, slot.worker, {
        mainWindow: null,
        onAppEvent: vi.fn(),
        onSlotExit: vi.fn(),
      })

      const pendingRequest = slotRequest(slot, 'getState')
      const rejection = pendingRequest.catch((error: unknown) => error)
      expect(slot.pendingRequests.size).toBe(1)

      processEmitter.emit('exit', 17)
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
