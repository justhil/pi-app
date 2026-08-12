import type { BrowserWindow } from 'electron'
import {
  attachWorkerHandlers,
  canAcquireNewWorker,
  disposeWorkerSlot,
  evictIdleWorkers,
  forkWorkerForCwd,
  remapSessionWorkerSlot,
  slotRequest,
} from './worker-manager-pool'
import type { WorkerAppEventForward, WorkerSlot } from './worker-manager-types'
import { readMaxSessionWorkers } from './worker-pool-config'
import { normalizeSessionKey, workspacePoolKey } from './worker-session-key'

export type NewSessionPoolOptions = {
  cwd: string
  pool: Map<string, WorkerSlot>
  mainWindow: BrowserWindow | null
  foregroundPoolKey: () => string | null
  slotMatchesCurrentRuntime: (slot: WorkerSlot) => boolean
  setForeground: (slot: WorkerSlot) => void
  onAppEvent: (payload: WorkerAppEventForward) => void
  onSlotExit: (slot: WorkerSlot, code: number) => void
}

function findReusableWorkspaceSlot(options: NewSessionPoolOptions): WorkerSlot | null {
  const foregroundKey = options.foregroundPoolKey()
  const foreground = foregroundKey ? options.pool.get(foregroundKey) : null
  if (
    foreground &&
    foreground.cwd === options.cwd &&
    options.slotMatchesCurrentRuntime(foreground) &&
    !foreground.sessionFile &&
    !foreground.agentTurnActive &&
    !foreground.stopping
  ) {
    return foreground
  }
  for (const slot of options.pool.values()) {
    if (
      slot.cwd === options.cwd &&
      options.slotMatchesCurrentRuntime(slot) &&
      !slot.sessionFile &&
      !slot.agentTurnActive &&
      !slot.stopping
    ) {
      return slot
    }
  }
  return null
}

function nextWorkspacePoolKey(pool: Map<string, WorkerSlot>, cwd: string): string {
  const base = workspacePoolKey(cwd)
  if (!pool.has(base)) return base
  for (let suffix = 1; ; suffix++) {
    const candidate = `${base}:new:${suffix}`
    if (!pool.has(candidate)) return candidate
  }
}

async function runNewSession(
  slot: WorkerSlot,
  options: NewSessionPoolOptions,
): Promise<{ sessionId: string; sessionFile?: string }> {
  if (slot.initPromise) await slot.initPromise
  const response = await slotRequest(slot, 'newSession')
  const sessionId = String(response.sessionId ?? '')
  const sessionFile = response.sessionFile
    ? normalizeSessionKey(String(response.sessionFile))
    : undefined
  if (sessionFile) {
    await remapSessionWorkerSlot(options.pool, slot.poolKey, sessionFile)
  }
  options.setForeground(slot)
  await evictIdleWorkers(options.pool, {
    foregroundKey: slot.poolKey,
    maxWorkers: readMaxSessionWorkers(),
    mainWindow: options.mainWindow,
  })
  return { sessionId, sessionFile }
}

export async function createNewSessionInPool(
  options: NewSessionPoolOptions,
): Promise<{ sessionId: string; sessionFile?: string }> {
  const reusable = findReusableWorkspaceSlot(options)
  if (reusable) return runNewSession(reusable, options)

  const capacity = canAcquireNewWorker(options.pool)
  if (!capacity.ok) throw new Error(capacity.reason)
  if (options.pool.size >= readMaxSessionWorkers()) {
    await evictIdleWorkers(options.pool, {
      foregroundKey: null,
      maxWorkers: readMaxSessionWorkers() - 1,
      mainWindow: options.mainWindow,
    })
  }

  const poolKey = nextWorkspacePoolKey(options.pool, options.cwd)
  const { slot, init } = await forkWorkerForCwd(options.cwd, {
    poolKey,
    sessionFile: null,
  })
  options.pool.set(poolKey, slot)
  attachWorkerHandlers(slot, slot.worker, {
    mainWindow: options.mainWindow,
    getForegroundPoolKey: options.foregroundPoolKey,
    onAppEvent: options.onAppEvent,
    onSlotExit: options.onSlotExit,
  })

  try {
    await init
    return await runNewSession(slot, options)
  } catch (error) {
    if (options.pool.get(slot.poolKey) === slot) options.pool.delete(slot.poolKey)
    await disposeWorkerSlot(slot, options.mainWindow)
    throw error
  }
}
