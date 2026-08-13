import { BrowserWindow, Notification, ipcMain, screen } from 'electron'
import { join } from 'path'
import { resolveAppIcon } from './app-icon'
import { getMainWindow } from './window'
import { readSessionMetaFromFile } from './session-file-meta'
import { setCompletionDndUntil } from './completion-notification-settings'
import {
  forgetNotificationTarget,
  rememberNotificationTarget,
  takeNotificationTarget,
  type NotificationTarget,
} from './completion-notification-actions'
import type { CompletionCard } from './completion-notification-controller'
import {
  notificationBoundsLookLegal,
  notificationHostBounds,
  NOTIFICATION_MAX_VISIBLE,
} from './completion-notification-geometry'
import { notificationHostPageHtml } from './notification-host-page'
import { completionNotificationWindowOptions } from './completion-notification-window-options'
import { systemNotificationSilent } from './completion-system-notification'
import { traceAudio } from './audio-trace'

type DeliveryMode = 'auto' | 'custom' | 'system'

type ActiveCard = CompletionCard & { expiresAt: number }

let host: BrowserWindow | null = null
let hostReady = false
let hostFailed = false
let hoverPaused = false
let expireTimer: ReturnType<typeof setTimeout> | null = null
const active: ActiveCard[] = []
let listenersBound = false

function preferSystem(mode: DeliveryMode): boolean {
  return mode === 'system' || hostFailed
}

function workArea() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
}

function visibleCards(): ActiveCard[] {
  return active.slice(-NOTIFICATION_MAX_VISIBLE)
}

function sendUpdate(): void {
  if (!host || host.isDestroyed() || !hostReady) return
  host.webContents.send(
    'notification:update',
    visibleCards().map((card) => ({
      notificationId: card.notificationId,
      outcome: card.outcome,
      copy: card.copy,
      sound: card.sound,
    })),
  )
}

function placeHost(): boolean {
  if (!host || host.isDestroyed()) return false
  const area = workArea()
  const bounds = notificationHostBounds(area, visibleCards().length || 1)
  host.setBounds(bounds)
  return notificationBoundsLookLegal(host.getBounds(), area)
}

function scheduleExpire(): void {
  if (expireTimer) clearTimeout(expireTimer)
  expireTimer = null
  if (hoverPaused || active.length === 0) return
  const next = Math.min(...active.map((card) => card.expiresAt))
  const wait = Math.max(50, next - Date.now())
  expireTimer = setTimeout(() => {
    const now = Date.now()
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].expiresAt <= now) {
        forgetNotificationTarget(active[i].notificationId)
        active.splice(i, 1)
      }
    }
    if (active.length === 0) hideHost()
    else {
      placeHost()
      sendUpdate()
      scheduleExpire()
    }
  }, wait)
}

function hideHost(): void {
  if (host && !host.isDestroyed()) host.hide()
}

function ensureListeners(): void {
  if (listenersBound) return
  listenersBound = true
  ipcMain.on('notification:ready', (event) => {
    if (!host || event.sender !== host.webContents) return
    hostReady = true
    sendUpdate()
    if (active.length > 0) {
      host.showInactive()
      placeHost()
    }
  })
  ipcMain.on('notification:hover', (event, payload: { paused?: boolean }) => {
    if (!host || event.sender !== host.webContents) return
    hoverPaused = payload?.paused === true
    if (hoverPaused) {
      const extra = 30_000
      for (const card of active) card.expiresAt = Math.max(card.expiresAt, Date.now() + extra)
    }
    scheduleExpire()
  })
  ipcMain.on(
    'notification:action',
    (event, payload: { notificationId?: string; action?: 'open' | 'dismiss' | 'mute' }) => {
      if (!host || event.sender !== host.webContents) return
      const id = String(payload?.notificationId || '')
      const action = payload?.action
      if (!id || !action) return
      if (action === 'mute') {
        setCompletionDndUntil(Date.now() + 30 * 60_000)
        dismissCard(id)
        return
      }
      if (action === 'open') {
        void openNotificationTarget(id)
        dismissCard(id)
        return
      }
      dismissCard(id)
    },
  )
}

function dismissCard(id: string): void {
  const index = active.findIndex((card) => card.notificationId === id)
  if (index >= 0) active.splice(index, 1)
  forgetNotificationTarget(id)
  if (active.length === 0) hideHost()
  else {
    placeHost()
    sendUpdate()
    scheduleExpire()
  }
}

async function createHost(): Promise<boolean> {
  if (host && !host.isDestroyed()) return true
  ensureListeners()
  try {
    host = new BrowserWindow(
      completionNotificationWindowOptions(join(__dirname, '../preload/notification.cjs')),
    )
    host.setMenu(null)
    host.on('closed', () => {
      host = null
      hostReady = false
    })
    await host.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(notificationHostPageHtml())}`)
    return placeHost()
  } catch (error) {
    traceAudio('notification.host.fail', { error: String(error) })
    hostFailed = true
    if (host && !host.isDestroyed()) host.destroy()
    host = null
    return false
  }
}

function showSystemCard(card: CompletionCard): void {
  if (!Notification.isSupported()) return
  const n = new Notification({
    title: card.copy.title,
    body: card.copy.body,
    silent: systemNotificationSilent(card.sound),
    icon: resolveAppIcon(),
  })
  n.on('click', () => {
    void openNotificationTarget(card.notificationId)
  })
  n.show()
}

export async function openNotificationTarget(notificationId: string): Promise<boolean> {
  const target = takeNotificationTarget(notificationId)
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  if (!target) {
    win?.webContents.send('ipc:notification-open-session', { ok: false, reason: 'missing' })
    return false
  }
  if (!target.sessionFile) return true
  if (target.sessionFile) {
    const meta = readSessionMetaFromFile(target.sessionFile)
    if (!meta) {
      win?.webContents.send('ipc:notification-open-session', {
        ok: false,
        reason: 'gone',
        workspaceId: target.workspaceId,
      })
      return false
    }
    target.sessionId = target.sessionId || meta.sessionId
  }
  win?.webContents.send('ipc:notification-open-session', {
    ok: true,
    workspaceId: target.workspaceId,
    sessionId: target.sessionId,
    sessionFile: target.sessionFile,
  })
  return true
}

export async function presentCompletionCard(card: CompletionCard, mode: DeliveryMode): Promise<void> {
  const target: NotificationTarget = {
    workspaceId: card.workspaceId,
    sessionId: card.sessionId,
    sessionFile: card.sessionFile,
  }
  rememberNotificationTarget(card.notificationId, target)

  if (preferSystem(mode)) {
    showSystemCard(card)
    return
  }

  const ok = await createHost()
  if (!ok) {
    showSystemCard(card)
    return
  }
  active.push({ ...card, expiresAt: Date.now() + card.timeoutMs })
  if (active.length > NOTIFICATION_MAX_VISIBLE) {
    const dropped = active.shift()
    if (dropped) forgetNotificationTarget(dropped.notificationId)
  }
  placeHost()
  sendUpdate()
  host?.showInactive()
  scheduleExpire()
}

export function focusCompletionNotificationHost(): boolean {
  if (!host || host.isDestroyed() || active.length === 0) return false
  host.show()
  host.focus()
  host.webContents.send('notification:focus')
  return true
}

export function disposeCompletionDelivery(): void {
  if (expireTimer) clearTimeout(expireTimer)
  expireTimer = null
  active.length = 0
  hostReady = false
  hoverPaused = false
  if (host && !host.isDestroyed()) host.destroy()
  host = null
}
