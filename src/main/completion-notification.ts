import { basename } from 'path'
import type { AppEvent, CompletionEvent } from '@shared/app-events'
import { getMainWindow } from './window'
import { getPendingWorkerSessionFile } from './session-bind-state'
import {
  bindCompletionNotificationEvents,
  currentVisibleSessionFile,
} from './completion-notification-events'
import {
  createCompletionNotificationController,
  type CompletionNotificationController,
} from './completion-notification-controller'
import { disposeCompletionDelivery, presentCompletionCard } from './completion-notification-delivery'
import { readCompletionNotificationSettings } from './completion-notification-settings'

let controller: CompletionNotificationController | null = null
let unbindEvents: (() => void) | null = null

function projectLabel(workspaceId: string): string {
  const name = basename(String(workspaceId || '').replace(/\\/g, '/'))
  return name || 'pi Desktop'
}

function windowState() {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return { focused: false, visible: false, minimized: true }
  return {
    focused: win.isFocused(),
    visible: win.isVisible(),
    minimized: win.isMinimized(),
  }
}

function getController(): CompletionNotificationController {
  if (!controller) {
    controller = createCompletionNotificationController({
      now: () => Date.now(),
      delayMs: 2000,
      getSettings: () => readCompletionNotificationSettings(),
      getWindowState: windowState,
      getVisibleSessionFile: () => currentVisibleSessionFile() ?? getPendingWorkerSessionFile(),
      projectLabel,
      deliver: (card) => {
        void presentCompletionCard(card, readCompletionNotificationSettings().delivery)
      },
    })
  }
  return controller
}

function handleAppEvent(event: AppEvent): void {
  const ctrl = getController()
  if (event.type === 'run' && (event.phase === 'started' || event.phase === 'running')) {
    ctrl.notifyRunStarted(event.sessionFile, event.runId)
    return
  }
  if (event.type === 'completion') {
    ctrl.handleCompletion(event as CompletionEvent)
  }
}

function handleWorkerExit(slot: {
  cwd: string
  sessionFile?: string | null
}): void {
  getController().handleWorkerExitFailure({
    workspaceId: slot.cwd,
    sessionFile: slot.sessionFile,
  })
}

export function initializeCompletionNotifications(): void {
  if (unbindEvents) return
  unbindEvents = bindCompletionNotificationEvents({
    observeAppEvent: handleAppEvent,
    observeWorkerExit: handleWorkerExit,
    visibleSessionChanged: (sessionFile) => controller?.notifyVisibleSessionChanged(sessionFile),
    foregroundChanged: () => controller?.notifyVisibleSessionChanged(currentVisibleSessionFile()),
  })
}

export function deliverTestCompletionNotification(): void {
  getController().deliverTest()
}

export function disposeCompletionNotifications(): void {
  unbindEvents?.()
  unbindEvents = null
  controller?.dispose()
  controller = null
  disposeCompletionDelivery()
}
