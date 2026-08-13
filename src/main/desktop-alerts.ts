import { app, BrowserWindow } from 'electron'
import { configStore } from './config-store'
import { traceAudio } from './audio-trace'
import { presentCompletionCard } from './completion-notification-delivery'
import { buildCompletionNotificationCopy } from '@shared/completion-preview'

export type DesktopAlertKind = 'extension_ui' | 'run_idle'

export type DesktopAlertPayload = {
  kind: DesktopAlertKind
  title: string
  body: string
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

let appUserModelIdSet = false

function ensureNotificationIdentity(): void {
  if (appUserModelIdSet) return
  appUserModelIdSet = true
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.earendil.pi-desktop')
  }
}

/** Extension UI only. Run completion is owned by CompletionNotificationController. */
export function deliverDesktopAlert(win: BrowserWindow | null, payload: DesktopAlertPayload): void {
  if (payload.kind === 'run_idle') return

  const scenario = scenarioEnabled(payload.kind, payload.background === true)
  const doSound = soundEnabled()
  const doNotify = notificationEnabled()
  traceAudio('main.deliverDesktopAlert', {
    kind: payload.kind,
    title: payload.title,
    body: payload.body?.slice(0, 80),
    background: payload.background,
    scenario,
    willNotify: scenario && doNotify,
    willSound: scenario && doSound,
  })
  if (!scenario || (!doNotify && !doSound)) return

  ensureNotificationIdentity()
  const language = configStore.get('language') === 'en' ? 'en' : 'zh'
  const copy = buildCompletionNotificationCopy({
    language,
    outcome: 'success',
    promptPreview: payload.title,
    responsePreview: payload.body,
    previewMode: 'response',
  })
  void presentCompletionCard(
    {
      notificationId: `ext-${Date.now()}`,
      workspaceId: '',
      outcome: 'success',
      timeoutMs: 15_000,
      sound: doSound,
      copy: {
        ...copy,
        title: payload.title || copy.title,
        body: payload.body || copy.body,
        projectLabel: 'pi Desktop',
        openLabel: language === 'zh' ? '返回应用' : 'Back to app',
      },
    },
    doNotify ? 'auto' : 'custom',
  )

  if (!doNotify && win && !win.isDestroyed()) {
    win.flashFrame(true)
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.flashFrame(false)
    }, 2800)
  }
}
