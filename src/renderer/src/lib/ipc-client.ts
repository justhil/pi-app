// IPC Client - Renderer side typed IPC access
// Full implementation in ipc-contract task

declare global {
  interface Window {
    piDesktop: {
      ping: () => string
    }
  }
}

export const ipcClient = {
  ping: () => window.piDesktop?.ping() ?? 'no-bridge',
}
