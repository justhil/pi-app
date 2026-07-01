import { ipcMain, type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'

/** Gradual typing: handlers use structured req; default any until per-channel contracts land. */
export type IpcHandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, IpcHandlerFn>()

export function registerHandler(channel: string, handler: IpcHandlerFn): void {
  if (handlers.has(channel)) {
    ipcMain.removeHandler(channel)
  }
  handlers.set(channel, handler)
  ipcMain.handle(channel, async (_event, request) => {
    try {
      return await handler(request)
    } catch (error) {
      console.error(`[IPC:${channel}] Error:`, error)
      throw error
    }
  })
}

export function sendEvent(win: BrowserWindow, event: AppEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('ipc:events', event)
  }
}