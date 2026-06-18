import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '@shared/app-events'

const EVENTS_CHANNEL = 'ipc:events'
const WORKER_EXIT_CHANNEL = 'ipc:worker-exit'

const api = {
  invoke(channel: string, request?: any): Promise<any> {
    return ipcRenderer.invoke(channel, request)
  },

  onEvent(callback: (event: AppEvent) => void): () => void {
    const handler = (_event: unknown, data: AppEvent): void => callback(data)
    ipcRenderer.on(EVENTS_CHANNEL, handler)
    return () => ipcRenderer.off(EVENTS_CHANNEL, handler)
  },

  onWorkerExit(callback: (info: { code: number; cwd: string }) => void): () => void {
    const handler = (_event: unknown, data: { code: number; cwd: string }): void => callback(data)
    ipcRenderer.on(WORKER_EXIT_CHANNEL, handler)
    return () => ipcRenderer.off(WORKER_EXIT_CHANNEL, handler)
  },

  onAutoOpened(callback: (info: { workspaceId: string }) => void): () => void {
    const handler = (_event: unknown, data: { workspaceId: string }): void => callback(data)
    ipcRenderer.on('ipc:auto-opened', handler)
    return () => ipcRenderer.off('ipc:auto-opened', handler)
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
