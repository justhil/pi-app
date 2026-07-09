import { app, Notification, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { configStore } from './config-store'
import { traceAudio } from './audio-trace'

export type DesktopAlertKind = 'extension_ui' | 'run_idle'

export type DesktopAlertPayload = {
  kind: DesktopAlertKind
  title: string
  body: string
  /** Background session finished; requires alertOnBackgroundRunIdle */
  background?: boolean
}

function scenarioEnabled(kind: DesktopAlertKind, background?: boolean): boolean {
  if (kind === 'extension_ui') return configStore.get('alertOnExtensionUi') !== false
  if (background) {
    return (
      configStore.get('alertOnRunIdle') !== false &&
      configStore.get('alertOnBackgroundRunIdle') === true
    )
  }
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
  } catch (e) {
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
  const scenario = scenarioEnabled(payload.kind, payload.background === true)
  const doSound = soundEnabled()
  const doNotify = notificationEnabled()
  traceAudio('main.deliverDesktopAlert', {
    kind: payload.kind,
    title: payload.title,
    body: payload.body?.slice(0, 80),
    background: payload.background,
    scenario,
    alertSoundEnabled: configStore.get('alertSoundEnabled'),
    alertNotificationEnabled: configStore.get('alertNotificationEnabled'),
    willBeep: scenario && doSound,
    willNotify: scenario && doNotify,
  })
  if (!scenario) return

  if (doSound) {
    traceAudio('main.playAlertSound', { platform: process.platform })
    playAlertSound()
  }

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