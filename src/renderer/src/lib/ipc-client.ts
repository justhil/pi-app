import type { AppEvent } from '@shared/app-events'

declare global {
  interface Window {
    piDesktop?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: (channel: string, request?: any) => Promise<any>
      getPathForFile: (file: File) => string
      onEvent: (callback: (event: AppEvent) => void) => () => void
      onWorkerExit: (callback: (info: { code: number; cwd: string }) => void) => () => void
      onAutoOpened: (callback: (info: { workspaceId: string }) => void) => () => void
      onExtensionUIRequest: (callback: (request: unknown) => void) => () => void
      onExtensionUIDismiss: (callback: (payload: { type: string; id?: string; reason?: string }) => void) => () => void
      onAppUpdateAvailable: (
        callback: (info: { currentVersion: string; latestVersion: string; releaseUrl: string }) => void,
      ) => () => void
      onGitWorkspaceChanged: (callback: (payload: { cwd: string }) => void) => () => void
      ping: () => string
    }
  }
}

class IpcClientImpl {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async invoke<M extends string>(method: M, request?: any): Promise<any> {
    if (!window.piDesktop) {
      console.warn(`[IPC] piDesktop not available, stubbing ${method}`)
      return {}
    }
    return window.piDesktop.invoke(`ipc:${method}`, request)
  }
}

export const ipcClient = new IpcClientImpl()

export function onAppEvent(callback: (event: AppEvent) => void): () => void {
  if (!window.piDesktop) {
    console.warn('[IPC] piDesktop not available, event subscription disabled')
    return () => {}
  }
  return window.piDesktop.onEvent(callback)
}

export function onWorkerExit(callback: (info: { code: number; cwd: string }) => void): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onWorkerExit(callback)
}

export function onAutoOpened(callback: (info: { workspaceId: string }) => void): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onAutoOpened(callback)
}

export function onExtensionUIRequest(callback: (request: unknown) => void): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onExtensionUIRequest(callback)
}

export function onExtensionUIDismiss(
  callback: (payload: { type: string; id?: string; reason?: string }) => void,
): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onExtensionUIDismiss(callback)
}

export function onAppUpdateAvailable(
  callback: (info: { currentVersion: string; latestVersion: string; releaseUrl: string }) => void,
): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onAppUpdateAvailable(callback)
}

export function onGitWorkspaceChanged(callback: (payload: { cwd: string }) => void): () => void {
  if (!window.piDesktop) return () => {}
  return window.piDesktop.onGitWorkspaceChanged(callback)
}
