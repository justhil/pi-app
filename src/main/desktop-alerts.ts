import { app, Notification, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { configStore } from './config-store'

export type DesktopAlertKind = 'extension_ui' | 'run_idle'

export type DesktopAlertPayload = {
  kind: DesktopAlertKind
  title: string
  body: string
}

function scenarioEnabled(kind: DesktopAlertKind): boolean {
  if (kind === 'extension_ui') return configStore.get('alertOnExtensionUi') !== false
  return configStore.get('alertOnRunIdle') !== false
}

function soundEnabled(): boolean {
  return configStore.get('alertSoundEnabled') !== false
}

function notificationEnabled(): boolean {
  return configStore.get('alertNotificationEnabled') !== false
}

function playAlertSound(): void {
  if (process.platform === 'win32') {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', '[console]::beep(880,120); Start-Sleep -Milliseconds 40; [console]::beep(660,120)'],
      { windowsHide: true },
      () => {},
    )
    return
  }
  if (process.platform === 'darwin') {
    execFile('afplay', ['/System/Library/Sounds/Glass.aiff'], () => {})
    return
  }
  try {
    process.stdout.write('\x07')
  } catch {
    /* ignore */
  }
}

let appUserModelIdSet = false

function ensureNotificationIdentity(): void {
  if (appUserModelIdSet) return
  appUserModelIdSet = true
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.earendil.pi-desktop')
  }
}

export function deliverDesktopAlert(win: BrowserWindow | null, payload: DesktopAlertPayload): void {
  if (!scenarioEnabled(payload.kind)) return

  const doSound = soundEnabled()
  const doNotify = notificationEnabled()

  if (doSound) playAlertSound()

  if (doNotify && Notification.isSupported()) {
    ensureNotificationIdentity()
    const n = new Notification({
      title: payload.title,
      body: payload.body,
      silent: true,
    })
    n.on('click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    n.show()
  } else if (doSound && win && !win.isDestroyed()) {
    win.flashFrame(true)
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.flashFrame(false)
    }, 2800)
  }
}