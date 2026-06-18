import { contextBridge, ipcRenderer } from 'electron'
import type { IpcMethodName, IpcRequest, IpcResponse } from '@shared/ipc-contract'
import { EVENTS_CHANNEL } from '@shared/ipc-contract'
import type { AppEvent } from '@shared/app-events'

const api = {
  invoke<M extends IpcMethodName>(method: M, request: IpcRequest<M>): Promise<IpcResponse<M>> {
    return ipcRenderer.invoke(`ipc:${method}`, request)
  },

  onEvent(callback: (event: AppEvent) => void): () => void {
    const handler = (_event: unknown, data: AppEvent): void => callback(data)
    ipcRenderer.on(EVENTS_CHANNEL, handler)
    return () => ipcRenderer.off(EVENTS_CHANNEL, handler)
  },

  ping: (): string => 'pong',
}

export type PiDesktopAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('piDesktop', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.piDesktop = api
}
