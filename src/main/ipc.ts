import { ipcMain, type BrowserWindow } from 'electron'
import type { IpcMethodName, IpcRequest, IpcResponse } from '@shared/ipc-contract'
import { EVENTS_CHANNEL } from '@shared/ipc-contract'

type HandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, HandlerFn>()

export function registerHandler<M extends IpcMethodName>(
  method: M,
  handler: (request: IpcRequest<M>) => Promise<IpcResponse<M>>,
): void {
  const channel = `ipc:${method}`
  handlers.set(channel, handler as HandlerFn)
  ipcMain.handle(channel, (_event, request) => handler(request))
}

export function unregisterHandler(method: IpcMethodName): void {
  const channel = `ipc:${method}`
  handlers.delete(channel)
  ipcMain.removeHandler(channel)
}

export function sendEvent(win: BrowserWindow, event: unknown): void {
  win.webContents.send(EVENTS_CHANNEL, event)
}

export function registerAllHandlers(): void {
  // Handlers will be registered by feature modules as they are implemented
  // For now, register stub handlers so the app doesn't crash on IPC calls

  const stubMethods: IpcMethodName[] = [
    'workspace.open',
    'workspace.switch',
    'session.list',
    'session.open',
    'session.new',
    'session.fork',
    'session.clone',
    'session.rename',
    'session.compact',
    'session.export',
    'prompt.send',
    'prompt.sendWithImages',
    'prompt.steer',
    'prompt.followUp',
    'prompt.abort',
    'model.list',
    'model.set',
    'model.cycle',
    'thinkingLevel.set',
    'commands.list',
    'review.getDiff',
    'extensions.list',
    'extensions.setOverride',
    'registry.refresh',
    'settings.get',
    'settings.set',
  ]

  for (const method of stubMethods) {
    registerHandler(method, async (req: any) => {
      console.warn(`[IPC] Stub handler for ${method}:`, req)
      return {} as any
    })
  }
}
