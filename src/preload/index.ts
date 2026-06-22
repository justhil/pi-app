import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent } from '@shared/app-events'

const EVENTS_CHANNEL = 'ipc:events'
const WORKER_EXIT_CHANNEL = 'ipc:worker-exit'
const EXT_UI_CHANNEL = 'ipc:extension-ui-request'
const EXT_UI_DISMISS_CHANNEL = 'ipc:extension-ui-dismiss'
const APP_UPDATE_CHANNEL = 'ipc:app-update-available'

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

  onExtensionUIRequest(callback: (request: unknown) => void): () => void {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on(EXT_UI_CHANNEL, handler)
    return () => ipcRenderer.off(EXT_UI_CHANNEL, handler)
  },

  onExtensionUIDismiss(callback: (payload: { type: string; id?: string; reason?: string }) => void): () => void {
    const handler = (_event: unknown, data: { type: string; id?: string; reason?: string }): void =>
      callback(data)
    ipcRenderer.on(EXT_UI_DISMISS_CHANNEL, handler)
    return () => ipcRenderer.off(EXT_UI_DISMISS_CHANNEL, handler)
  },

  onAppUpdateAvailable(
    callback: (info: { currentVersion: string; latestVersion: string; releaseUrl: string }) => void,
  ): () => void {
    const handler = (
      _event: unknown,
      data: { currentVersion: string; latestVersion: string; releaseUrl: string },
    ): void => callback(data)
    ipcRenderer.on(APP_UPDATE_CHANNEL, handler)
    return () => ipcRenderer.off(APP_UPDATE_CHANNEL, handler)
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
