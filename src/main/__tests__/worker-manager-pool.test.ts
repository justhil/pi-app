import { describe, expect, it } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'
import { evictBackgroundWorkers } from '../worker-manager-pool'

function fakeSlot(cwd: string, active: boolean): WorkerSlot {
  return {
    cwd,
    worker: {} as WorkerSlot['worker'],
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: active,
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

describe('evictBackgroundWorkers', () => {
  it('keeps agentTurnActive background cwd when switching foreground', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/w/a', fakeSlot('/w/a', true))
    pool.set('/w/b', fakeSlot('/w/b', false))
    evictBackgroundWorkers(pool, '/w/b', '/w/a')
    expect(pool.has('/w/a')).toBe(true)
    expect(pool.has('/w/b')).toBe(true)
  })

  it('keeps previous cwd even when idle so switch-back reuses worker', () => {
    const pool = new Map<string, WorkerSlot>()
    pool.set('/w/a', fakeSlot('/w/a', false))
    pool.set('/w/b', fakeSlot('/w/b', false))
    evictBackgroundWorkers(pool, '/w/b', '/w/a')
    expect(pool.has('/w/a')).toBe(true)
    expect(pool.has('/w/b')).toBe(true)
  })
})