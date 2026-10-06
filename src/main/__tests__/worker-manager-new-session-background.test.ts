import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerSlot } from '../worker-manager-types'

const pool = vi.hoisted(() => ({
  slotRequest: vi.fn(),
  evictIdleWorkers: vi.fn(async () => {}),
  forkWorkerForCwd: vi.fn(),
  attachWorkerHandlers: vi.fn(),
}))

vi.mock('../config-store', () => ({ configStore: { get: vi.fn(() => undefined) } }))
vi.mock('../worker-manager-pool', async (importOriginal) => {
  const real = await importOriginal<typeof import('../worker-manager-pool')>()
  return { ...real, ...pool }
})

import { createNewSessionInPool } from '../worker-manager-new-session'

function slot(poolKey: string, cwd: string): WorkerSlot {
  return {
    poolKey,
    cwd,
    runtime: { mode: 'host', distro: null },
    sessionFile: null,
    worker: {} as WorkerSlot['worker'],
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
    lastIdleAt: 0,
    lastForegroundAt: 0,
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

const cwd = '/work/app'

function setup(slots: WorkerSlot[], fgKey: string) {
  const map = new Map(slots.map((s) => [s.poolKey, s]))
  const setForeground = vi.fn()
  const opts = {
    cwd,
    pool: map,
    mainWindow: null,
    foregroundPoolKey: () => fgKey,
    slotMatchesCurrentRuntime: () => true,
    setForeground,
    onAppEvent: () => {},
    onSlotExit: () => {},
  }
  return { map, setForeground, opts }
}

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  pool.slotRequest.mockImplementation(async () => ({ sessionId: `s${++n}`, sessionFile: `/tmp/new-${n}.jsonl` }))
  pool.forkWorkerForCwd.mockImplementation(async (_cwd: string, o: { poolKey: string }) => ({ slot: slot(o.poolKey, cwd), init: Promise.resolve() }))
})

describe('createNewSessionInPool background mode', () => {
  it('desktop path still reuses the foreground workspace slot', async () => {
    const fg = slot('ws:/work/app', cwd)
    const { setForeground, opts } = setup([fg], fg.poolKey)
    await createNewSessionInPool(opts)
    expect(pool.slotRequest).toHaveBeenCalledWith(fg, 'newSession')
    expect(setForeground).toHaveBeenCalledWith(fg)
  })

  it('never takes the foreground slot; forks a new worker instead and protects the foreground', async () => {
    const fg = slot('ws:/work/app', cwd)
    const { map, setForeground, opts } = setup([fg], fg.poolKey)
    const r = await createNewSessionInPool({ ...opts, background: true })
    expect(pool.forkWorkerForCwd).toHaveBeenCalledTimes(1)
    expect(pool.slotRequest).not.toHaveBeenCalledWith(fg, 'newSession')
    expect(map.get(fg.poolKey)).toBe(fg)
    expect(fg.sessionFile).toBeNull()
    expect(r.sessionFile).toContain('/tmp/new-1.jsonl')
    // setForeground is the caller's no-op/touch in background mode; eviction protects the desktop's foreground.
    expect(setForeground).toHaveBeenCalledTimes(1)
    expect(setForeground.mock.calls[0][0]).not.toBe(fg)
    for (const call of pool.evictIdleWorkers.mock.calls as unknown as Array<[unknown, { foregroundKey: string | null }]>) {
      expect(call[1].foregroundKey).toBe(fg.poolKey)
    }
  })

  it('reuses another idle workspace slot when one exists', async () => {
    const fg = slot('ws:/work/app', cwd)
    const spare = slot('ws:/work/app:new:1', cwd)
    const { opts } = setup([fg, spare], fg.poolKey)
    await createNewSessionInPool({ ...opts, background: true })
    expect(pool.slotRequest).toHaveBeenCalledWith(spare, 'newSession')
    expect(pool.forkWorkerForCwd).not.toHaveBeenCalled()
  })
})
