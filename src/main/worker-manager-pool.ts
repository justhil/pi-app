import { utilityProcess, app, type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import { windowsPathToWsl } from '@shared/wsl-path'
import { resolveActiveSdk } from './sdk-loader'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'
import { readMaxSessionWorkers, minutesToIdleDelayMs, readSessionWorkerIdleTimeoutMinutes } from './worker-pool-config'
import { normalizeSessionKey, workspacePoolKey } from './worker-session-key'
import {
  createUtilityProcessTransport,
  createWslWorkerTransport,
  type WorkerTransport,
} from './worker-transport'
import { getAgentRuntimeConfig } from './wsl/runtime-config'
import { resolveWslActiveSdk } from './wsl/sdk-resolve'
import { syncWorkerBundleToWsl } from './wsl/worker-host'
import { resolveUtilityEntry } from './utility-entry-path'

function createSlot(
  poolKey: string,
  cwd: string,
  runtime: { mode: 'host' | 'wsl'; distro: string | null },
  worker: WorkerTransport,
  sessionFile: string | null = null,
): WorkerSlot {
  const now = Date.now()
  return {
    poolKey,
    cwd,
    runtime,
    sessionFile,
    worker,
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
    lastIdleAt: now,
    lastForegroundAt: now,
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
  }
}

function safeWrite(msg: string): void {
  try {
    process.stderr.write(msg + '\n')
  } catch {
    /* ignore */
  }
}

export function rejectPendingWorkerRequests(slot: WorkerSlot, reason: Error): void {
  for (const pending of slot.pendingRequests.values()) {
    clearTimeout(pending.timer)
    pending.reject(reason)
  }
  slot.pendingRequests.clear()
}

export async function remapSessionWorkerSlot(
  pool: Map<string, WorkerSlot>,
  sourceKey: string,
  sessionFile: string,
  dispose: (slot: WorkerSlot) => Promise<void> = disposeWorkerSlot,
): Promise<string> {
  const targetKey = normalizeSessionKey(sessionFile)
  if (!targetKey) return sourceKey
  const source = pool.get(sourceKey)
  if (!source || source.stopping) return sourceKey
  if (sourceKey === targetKey) {
    source.sessionFile = targetKey
    return targetKey
  }

  const conflict = pool.get(targetKey)
  if (conflict && conflict !== source) {
    if (conflict.agentTurnActive) throw new Error('SESSION_WORKER_TARGET_BUSY')
    rejectPendingWorkerRequests(conflict, new Error('Worker slot replaced'))
    await dispose(conflict)
    if (pool.get(targetKey) === conflict) pool.delete(targetKey)
  }

  if (pool.get(sourceKey) === source) pool.delete(sourceKey)
  source.poolKey = targetKey
  source.sessionFile = targetKey
  pool.set(targetKey, source)
  return targetKey
}

export function attachWorkerHandlers(
  slot: WorkerSlot,
  transport: WorkerTransport,
  opts: {
    mainWindow: BrowserWindow | null
    onAppEvent: (payload: {
      event: AppEvent
      fromCwd: string
      fromPoolKey: string
      sessionFile: string | null
      agentTurnActive: boolean
    }) => void
    onSlotExit: (slot: WorkerSlot, code: number) => void
    /** When set, only forward extension UI from this pool key (X1). */
    getForegroundPoolKey?: () => string | null
  },
): void {
  const onStderrChunk = (chunk: string): void => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
    }
  }
  const onStdoutChunk = (chunk: string): void => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
    }
  }
  transport.onStderr(onStderrChunk)
  transport.onStdout(onStdoutChunk)

  transport.onMessage((data) => {
    if (slot.worker !== transport) return
    if (!data || typeof data !== 'object') return

    if (data.type === 'app-event') {
      const ev = data.event as AppEvent
      if (ev?.type === 'run') {
        if (ev.phase === 'running' || ev.phase === 'started') {
          slot.agentTurnActive = true
        } else if (ev.phase === 'idle' || ev.phase === 'failed' || ev.phase === 'cancelled') {
          slot.agentTurnActive = false
          slot.lastIdleAt = Date.now()
        }
      }
      opts.onAppEvent({
        event: ev,
        fromCwd: slot.cwd,
        fromPoolKey: slot.poolKey,
        sessionFile: slot.sessionFile,
        agentTurnActive: slot.agentTurnActive,
      })
    }

    const win = opts.mainWindow
    if (
      (data.type === 'extension-ui-dismiss' || data.type === 'extension-ui-dismiss-all') &&
      win &&
      !win.isDestroyed()
    ) {
      const fg = opts.getForegroundPoolKey?.() ?? null
      if (fg && fg !== slot.poolKey) {
        // X1: only foreground session dismiss noise
      } else {
        win.webContents.send('ipc:extension-ui-dismiss', {
          type: data.type,
          id: data.id,
          reason: data.reason,
        })
      }
    }

    if (data.type === 'extension-ui-request' && win && !win.isDestroyed()) {
      const req = data.request as { method?: string; notifyType?: string; message?: string }
      const method = req?.method || ''
      const fg = opts.getForegroundPoolKey?.() ?? null
      const isForeground = !fg || fg === slot.poolKey
      if (!isForeground && method !== 'notify') return
      const allow =
        method !== 'notify' || slot.agentTurnActive || req.notifyType === 'error'
      if (!allow) return
      if (!isForeground && req.notifyType !== 'error') return
      win.webContents.send('ipc:extension-ui-request', data.request)
    }

    if (data.type === 'init-done' && slot.initResolver) {
      slot.sdkFallback = !!data.sdkFallback
      if (slot.sdkFallback) safeWrite('[WorkerManager] Target SDK import failed, worker fell back to builtin')
      slot.initResolver({
        sessionId: String(data.sessionId ?? ''),
        model: data.model as string | undefined,
        thinkingLevel: data.thinkingLevel as string | undefined,
      })
      slot.initResolver = null
      slot.initRejecter = null
    }
    if (data.type === 'error' && slot.initRejecter) {
      slot.initRejecter(new Error(String(data.error ?? 'Worker error')))
      slot.initResolver = null
      slot.initRejecter = null
      slot.initPromise = null
    }

    const requestId = typeof data.requestId === 'string' ? data.requestId : ''
    if (requestId && slot.pendingRequests.has(requestId)) {
      const pending = slot.pendingRequests.get(requestId)!
      clearTimeout(pending.timer)
      slot.pendingRequests.delete(requestId)
      if (data.type === 'error') pending.reject(new Error(String(data.error ?? 'Worker error')))
      else pending.resolve(data)
    }
  })

  transport.onExit((code) => {
    if (slot.worker !== transport) {
      safeWrite(`[WorkerManager] Ignoring stale worker exit (code ${code})`)
      return
    }
    rejectPendingWorkerRequests(slot, new Error(`Worker exited with code ${code}`))
    opts.onSlotExit(slot, code)
  })
}

export async function disposeWorkerSlot(slot: WorkerSlot): Promise<void> {
  slot.stopping = true
  if (slot.initRejecter) {
    slot.initRejecter(new Error('Worker stopped'))
    slot.initResolver = null
    slot.initRejecter = null
  }
  slot.initPromise = null
  const proc = slot.worker
  const wasActive = !!slot.agentTurnActive
  // Always try abort on dispose when we have a session file — agentTurnActive can lag
  // behind true streaming if events were missed, and force-quit needs a terminal leaf.
  if (wasActive || slot.sessionFile) {
    try {
      await slotRequest(slot, 'abort', slot.sessionFile ? { sessionFile: slot.sessionFile } : {}).catch(
        () => null,
      )
    } catch {
      /* ignore */
    }
    // Give pi SessionManager time to persist aborted assistant entry
    await new Promise((r) => setTimeout(r, wasActive ? 200 : 80))
  }
  try {
    proc.postMessage({ type: 'dispose' })
  } catch {
    /* ignore */
  }
  // Allow worker to flush session JSONL after abort+dispose
  await new Promise((r) => setTimeout(r, wasActive ? 500 : 250))
  try {
    proc.kill()
  } catch {
    /* ignore */
  }
  for (const [, pending] of slot.pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Worker stopped'))
  }
  slot.pendingRequests.clear()
}

export function slotRequest(
  slot: WorkerSlot,
  type: string,
  data?: Record<string, unknown>,
): Promise<WorkerResponsePayload> {
  const proc = slot.worker
  const requestId = `req-${++slot.requestCounter}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (slot.pendingRequests.has(requestId)) {
        slot.pendingRequests.delete(requestId)
        reject(new Error(`Worker request ${type} timed out`))
      }
    }, 120000)
    slot.pendingRequests.set(requestId, { resolve, reject, timer })
    try {
      proc.postMessage({ type, requestId, ...data })
    } catch (e) {
      clearTimeout(timer)
      slot.pendingRequests.delete(requestId)
      reject(e)
    }
  })
}

export async function forkWorkerForCwd(
  cwd: string,
  opts?: { poolKey?: string; sessionFile?: string | null },
): Promise<{ slot: WorkerSlot; init: Promise<WorkerInitResult> }> {
  const poolKey = opts?.poolKey || workspacePoolKey(cwd)
  const runtime = getAgentRuntimeConfig()
  let transport: WorkerTransport
  let sdkPath: string | null
  let workerCwd = cwd
  if (runtime.mode === 'wsl' && runtime.distro) {
    const sdk = await resolveWslActiveSdk(runtime.distro)
    if (!sdk) {
      throw new Error(
        `[WSL] 发行版 ${runtime.distro} 内未找到 pi-coding-agent，请在 WSL 中执行 npm i -g @earendil-works/pi-coding-agent`,
      )
    }
    const workerWslPath = syncWorkerBundleToWsl(runtime.distro)
    if (!workerWslPath) {
      throw new Error('[WSL] 无法将 worker 同步到 WSL 发行版（检查 out/main/worker.mjs）')
    }
    const wslCwd = windowsPathToWsl(runtime.distro, cwd)
    workerCwd = wslCwd
    transport = createWslWorkerTransport({
      distro: runtime.distro,
      wslCwd,
      workerWslPath,
    })
    sdkPath = sdk.entryPath
  } else {
    const forked = utilityProcess.fork(resolveUtilityEntry('worker.mjs'), [], { stdio: 'pipe' })
    transport = createUtilityProcessTransport(forked)
    const activeSdk = resolveActiveSdk(app.getPath('userData'))
    sdkPath = activeSdk.kind === 'builtin' ? null : activeSdk.entryPath
  }
  const slot = createSlot(poolKey, cwd, runtime, transport, opts?.sessionFile ?? null)
  const initPromise = new Promise<WorkerInitResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (slot.worker !== transport) return
      slot.initResolver = null
      slot.initRejecter = null
      slot.initPromise = null
      reject(new Error('Worker init timeout (60s)'))
    }, 60000)
    slot.initResolver = (r) => {
      clearTimeout(timer)
      resolve(r)
    }
    slot.initRejecter = (e) => {
      clearTimeout(timer)
      reject(e)
    }
  })
  slot.initPromise = initPromise
  transport.postMessage({ type: 'init', cwd: workerCwd, sdkPath })
  return { slot, init: initPromise }
}

/**
 * Evict idle workers to free capacity. Never disposes agentTurnActive slots.
 * @deprecated Prefer evictIdleWorkers with maxWorkers from settings.
 */
export function evictBackgroundWorkers(
  pool: Map<string, WorkerSlot>,
  foregroundKey: string,
  _keepKey?: string | null,
): void {
  void evictIdleWorkers(pool, {
    foregroundKey,
    maxWorkers: readMaxSessionWorkers(),
  })
}

export async function evictIdleWorkers(
  pool: Map<string, WorkerSlot>,
  opts: {
    foregroundKey: string | null
    maxWorkers?: number
  },
): Promise<void> {
  const maxWorkers = opts.maxWorkers ?? readMaxSessionWorkers()
  // Hard capacity: dispose oldest-foreground idle first. UI focus changes alone
  // never dispose idle workers; TTL cleanup is owned by pruneIdleWorkersByTimeout.
  while (pool.size > maxWorkers) {
    let victimKey: string | null = null
    let oldestFg = Number.POSITIVE_INFINITY
    for (const [key, slot] of pool) {
      if (key === opts.foregroundKey || slot.agentTurnActive) continue
      if (slot.lastForegroundAt < oldestFg) {
        oldestFg = slot.lastForegroundAt
        victimKey = key
      }
    }
    if (!victimKey) break
    const s = pool.get(victimKey)!
    pool.delete(victimKey)
    await disposeWorkerSlot(s)
  }
}

/** Dispose idle slots past TTL. Returns number of slots disposed. */
export function pruneIdleWorkersByTimeout(
  pool: Map<string, WorkerSlot>,
  foregroundKey: string | null,
  nowMs = Date.now(),
): number {
  const delay = minutesToIdleDelayMs(readSessionWorkerIdleTimeoutMinutes())
  if (delay == null) return 0
  let removed = 0
  for (const [key, slot] of [...pool.entries()]) {
    if (key === foregroundKey) continue
    if (slot.agentTurnActive) continue
    if (nowMs - slot.lastIdleAt < delay) continue
    void disposeWorkerSlot(slot)
    pool.delete(key)
    removed++
  }
  return removed
}

export async function getBackgroundWorkerState(
  pool: Map<string, WorkerSlot>,
  poolKey: string,
): Promise<{ cwd: string; poolKey: string; state: Record<string, unknown> } | null> {
  const slot = pool.get(poolKey)
  if (!slot || slot.stopping) return null
  try {
    const r = await slotRequest(slot, 'getState')
    const state = (r.state as Record<string, unknown>) || {}
    return { cwd: slot.cwd, poolKey, state }
  } catch {
    return null
  }
}

export function canAcquireNewWorker(
  pool: Map<string, WorkerSlot>,
  maxWorkers?: number,
): { ok: true } | { ok: false; reason: string } {
  const max = maxWorkers ?? readMaxSessionWorkers()
  if (pool.size < max) return { ok: true }
  for (const slot of pool.values()) {
    if (!slot.agentTurnActive) return { ok: true }
  }
  return {
    ok: false,
    reason: `Worker pool full (${max} running sessions). Stop a turn or raise maxSessionWorkers.`,
  }
}
