import { describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import {
  canAcquireNewWorker,
  evictBackgroundWorkers,
  evictIdleWorkers,
  pruneIdleWorkersByTimeout,
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
  it('should_keep_agentTurnActive_background_when_switching_foreground', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/s/a', fakeSlot('/s/a', '/w/a', true, 1))
    pool.set('/s/b', fakeSlot('/s/b', '/w/a', false, 2))
    evictIdleWorkers(pool, { foregroundKey: '/s/b', keepKeys: ['/s/a'], maxWorkers: 4 })
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

  it('legacy_evictBackgroundWorkers_keeps_previous_key', () => {
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
