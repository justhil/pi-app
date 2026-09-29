import { ipcMain, type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'
import { z, type ZodSchema } from 'zod'

/** Documented JSON invoke shape from preload (see doc/IPC-CONTRACTS.md). */
export type IpcInvokeBody = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcHandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, IpcHandlerFn>()

/**
 * Dev diagnostics (PI_PERF_TRACE=1): per-channel timings — `sync` is how long the handler held the
 * main thread before yielding, `total` includes awaited work — plus an event-loop stall monitor.
 * A slow `sync` delays every other IPC reply, which is what makes switches feel sticky.
 */
const PERF_TRACE = !!process.env.PI_PERF_TRACE
if (PERF_TRACE) {
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const lag = now - last - 50
    if (lag > 80) console.log(`[perf] main event loop blocked ~${lag}ms`)
    last = now
  }, 50).unref?.()
}

export function registerHandler(channel: string, handler: IpcHandlerFn): void {
  if (handlers.has(channel)) {
    ipcMain.removeHandler(channel)
  }
  handlers.set(channel, handler)
  ipcMain.handle(channel, async (_event, request) => {
    const started = PERF_TRACE ? Date.now() : 0
    try {
      const pending = handler(request as IpcInvokeBody)
      if (!PERF_TRACE) return await pending
      const sync = Date.now() - started
      const result = await pending
      const total = Date.now() - started
      if (total >= 40 || sync >= 15) console.log(`[perf] ipc ${channel} sync=${sync}ms total=${total}ms`)
      return result
    } catch (error) {
      console.error(`[IPC:${channel}] Error:`, error)
      throw error
    }
  })
}

/** Register a handler with Zod schema validation on the input. */
export function registerHandlerWithSchema<T>(
  channel: string,
  schema: ZodSchema<T>,
  handler: (request: T) => Promise<unknown>,
): void {
  registerHandler(channel, async (request) => {
    const result = schema.safeParse(request)
    if (!result.success) {
      const err = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new Error(`Invalid IPC input for ${channel}: ${err}`)
    }
    return handler(result.data)
  })
}

export function sendEvent(win: BrowserWindow, event: AppEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('ipc:events', event)
  }
}