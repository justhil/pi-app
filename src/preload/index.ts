import { contextBridge } from 'electron'

const api = {
  // IPC API will be filled in by ipc-contract task
  // For now, expose a minimal ping for scaffold verification
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
