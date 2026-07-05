import { ipcMain, type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'
import { z, type ZodSchema } from 'zod'

/** Documented JSON invoke shape from preload (see doc/IPC-CONTRACTS.md). */
export type IpcInvokeBody = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcHandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, IpcHandlerFn>()

export function registerHandler(channel: string, handler: IpcHandlerFn): void {
  if (handlers.has(channel)) {
    ipcMain.removeHandler(channel)
  }
  handlers.set(channel, handler)
  ipcMain.handle(channel, async (_event, request) => {
    try {
      return await handler(request as IpcInvokeBody)
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