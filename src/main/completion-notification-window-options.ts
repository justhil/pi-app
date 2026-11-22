import type { BrowserWindowConstructorOptions } from 'electron'
import { NOTIFICATION_HOST_WIDTH, notificationHostSize } from './completion-notification-geometry'

export function completionNotificationWindowOptions(
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: NOTIFICATION_HOST_WIDTH,
    height: notificationHostSize(1).height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      partition: 'notify',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}
