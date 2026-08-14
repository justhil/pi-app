import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppEvent } from '@shared/app-events'
import { CUSTOM_THEME_DISABLED_RENDERER_ARGUMENT } from '@shared/custom-theme'
import { isAllowedIpcChannel } from '@shared/ipc-channels'

const EVENTS_CHANNEL = 'ipc:events'
const WORKER_EXIT_CHANNEL = 'ipc:worker-exit'
const EXT_UI_CHANNEL = 'ipc:extension-ui-request'
const EXT_UI_DISMISS_CHANNEL = 'ipc:extension-ui-dismiss'
const APP_UPDATE_CHANNEL = 'ipc:app-update-available'
const APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL = 'ipc:app-update-download-progress'

const api = {
  customThemeDisabled: process.argv.includes(CUSTOM_THEME_DISABLED_RENDERER_ARGUMENT),
  platform: process.platform,

  invoke(channel: string, request?: unknown): Promise<unknown> {
    if (!isAllowedIpcChannel(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, request)
  },

  getPathForFile(file: File): string {
    try {
      const p = webUtils.getPathForFile(file)
      if (p) return p
    } catch (e) {
      /* fall through */
    }
    const legacy = (file as { path?: string }).path
    if (legacy) return legacy
    throw new Error('Could not resolve file path for attachment')
  },

  onEvent(callback: (event: AppEvent) => void): () => void {
    const handler = (_event: unknown, data: AppEvent): void => callback(data)
    ipcRenderer.on(EVENTS_CHANNEL, handler)
    return () => ipcRenderer.off(EVENTS_CHANNEL, handler)
  },

  onWorkerExit(
    callback: (info: { code: number; cwd: string; sessionFile?: string | null; poolKey?: string | null }) => void,
  ): () => void {
    const handler = (
      _event: unknown,
      data: { code: number; cwd: string; sessionFile?: string | null; poolKey?: string | null },
    ): void => callback(data)
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

  onAppUpdateAvailable(callback: (info: unknown) => void): () => void {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on(APP_UPDATE_CHANNEL, handler)
    return () => ipcRenderer.off(APP_UPDATE_CHANNEL, handler)
  },

  onAppUpdateDownloadProgress(callback: (info: unknown) => void): () => void {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on(APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL, handler)
    return () => ipcRenderer.off(APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL, handler)
  },

  onGitWorkspaceChanged(callback: (payload: { cwd: string }) => void): () => void {
    const handler = (_event: unknown, data: { cwd: string }): void => callback(data)
    ipcRenderer.on('ipc:git-workspace-changed', handler)
    return () => ipcRenderer.off('ipc:git-workspace-changed', handler)
  },

  onCloseRequested(callback: (info: { isStreaming: boolean }) => void): () => void {
    const handler = (_event: unknown, data: { isStreaming: boolean }): void => callback(data)
    ipcRenderer.on('ipc:close-requested', handler)
    return () => ipcRenderer.off('ipc:close-requested', handler)
  },
  onNotificationOpenSession(
    callback: (payload: {
      ok: boolean
      reason?: string
      workspaceId?: string
      sessionId?: string
      sessionFile?: string
    }) => void,
  ): () => void {
    const handler = (
      _event: unknown,
      data: {
        ok: boolean
        reason?: string
        workspaceId?: string
        sessionId?: string
        sessionFile?: string
      },
    ): void => callback(data)
    ipcRenderer.on('ipc:notification-open-session', handler)
    return () => ipcRenderer.off('ipc:notification-open-session', handler)
  },
  onSessionExternalUpdate(callback: (payload: { sessionFile: string }) => void): () => void {
    const handler = (_event: unknown, data: { sessionFile: string }): void => callback(data)
    ipcRenderer.on('ipc:session-external-update', handler)
    return () => ipcRenderer.off('ipc:session-external-update', handler)
  },

  onWorkspaceSessionsChanged(callback: (payload: { workspaceId: string }) => void): () => void {
    const handler = (_event: unknown, data: { workspaceId: string }): void => callback(data)
    ipcRenderer.on('ipc:workspace-sessions-changed', handler)
    return () => ipcRenderer.off('ipc:workspace-sessions-changed', handler)
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
  // @ts-expect-error non-isolated preload fallback when contextBridge unavailable
  window.piDesktop = api
}
