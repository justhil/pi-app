import type { BrowserWindowConstructorOptions } from 'electron'

export function completionNotificationWindowOptions(
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: 380,
    height: 168,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    transparent: false,
    backgroundColor: '#f2f3f5',
    webPreferences: {
      preload,
      partition: 'notify',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}
