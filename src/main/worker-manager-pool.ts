import { utilityProcess, app, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import { resolveActiveSdk } from './sdk-loader'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'

const MAX_BACKGROUND_WORKERS = 4

function createSlot(cwd: string, worker: Electron.UtilityProcess): WorkerSlot {
  return {
    cwd,
    worker,
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
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

export function attachWorkerHandlers(
  slot: WorkerSlot,
  forked: Electron.UtilityProcess,
  opts: {
    mainWindow: BrowserWindow | null
    onAppEvent: (payload: { event: AppEvent; fromCwd: string; agentTurnActive: boolean }) => void
    onSlotExit: (slot: WorkerSlot, code: number) => void
  },
): void {
  if (forked.stderr) {
    forked.stderr.on('error', () => {})
    forked.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
      }
    })
  }
  if (forked.stdout) {
    forked.stdout.on('error', () => {})
    forked.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
      }
    })
  }

  forked.on('message', (event: { data?: WorkerResponsePayload } | WorkerResponsePayload) => {
    if (slot.worker !== forked) return
    const data = (typeof event === 'object' && event !== null && 'data' in event
      ? (event as { data?: WorkerResponsePayload }).data
      : event) as WorkerResponsePayload | undefined
    if (!data) return

    if (data.type === 'app-event') {
      const ev = data.event as AppEvent
      if (ev?.type === 'run') {
        if (ev.phase === 'running' || ev.phase === 'started') slot.agentTurnActive = true
        else if (ev.phase === 'idle' || ev.phase === 'failed' || ev.phase === 'cancelled') {
          slot.agentTurnActive = false
        }
      }
      opts.onAppEvent({ event: ev, fromCwd: slot.cwd, agentTurnActive: slot.agentTurnActive })
    }

    const win = opts.mainWindow
    if (
      (data.type === 'extension-ui-dismiss' || data.type === 'extension-ui-dismiss-all') &&
      win &&
      !win.isDestroyed()
    ) {
      win.webContents.send('ipc:extension-ui-dismiss', {
        type: data.type,
        id: data.id,
        reason: data.reason,
      })
    }

    if (data.type === 'extension-ui-request' && win && !win.isDestroyed()) {
      const req = data.request as { method?: string; notifyType?: string; message?: string }
      const method = req?.method || ''
      const allow =
        method !== 'notify' || slot.agentTurnActive || req.notifyType === 'error'
      if (!allow) return
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

  forked.on('exit', (code) => {
    if (slot.worker !== forked) {
      safeWrite(`[WorkerManager] Ignoring stale worker exit (code ${code})`)
      return
    }
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
  try {
    proc.postMessage({ type: 'dispose' })
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 150))
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

export async function forkWorkerForCwd(cwd: string): Promise<{ slot: WorkerSlot; init: Promise<WorkerInitResult> }> {
  const forked = utilityProcess.fork(join(__dirname, 'worker.mjs'), [], { stdio: 'pipe' })
  const slot = createSlot(cwd, forked)
  const initPromise = new Promise<WorkerInitResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (slot.worker !== forked) return
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
  const activeSdk = resolveActiveSdk(app.getPath('userData'))
  const sdkPath = activeSdk.kind === 'builtin' ? null : activeSdk.entryPath
  forked.postMessage({ type: 'init', cwd, sdkPath })
  return { slot, init: initPromise }
}

export function evictBackgroundWorkers(
  pool: Map<string, WorkerSlot>,
  foregroundCwd: string,
  keepCwd?: string | null,
): void {
  const keep = new Set<string>([foregroundCwd])
  if (keepCwd) keep.add(keepCwd)
  for (const [cwd, slot] of pool) {
    if (keep.has(cwd)) continue
    if (slot.agentTurnActive) continue
    void disposeWorkerSlot(slot).then(() => pool.delete(cwd))
  }
  while (pool.size > MAX_BACKGROUND_WORKERS) {
    let victim: string | null = null
    for (const [cwd, slot] of pool) {
      if (cwd === foregroundCwd || slot.agentTurnActive) continue
      victim = cwd
      break
    }
    if (!victim) break
    const s = pool.get(victim)!
    void disposeWorkerSlot(s).then(() => pool.delete(victim!))
  }
}

export async function getBackgroundWorkerState(
  pool: Map<string, WorkerSlot>,
  cwd: string,
): Promise<{ cwd: string; state: Record<string, unknown> } | null> {
  const slot = pool.get(cwd)
  if (!slot || slot.stopping) return null
  try {
    const r = await slotRequest(slot, 'getState')
    const state = (r.state as Record<string, unknown>) || {}
    return { cwd, state }
  } catch {
    return null
  }
}