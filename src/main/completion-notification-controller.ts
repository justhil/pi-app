import type { CompletionEvent } from '@shared/app-events'
import {
  buildCompletionNotificationCopy,
  type CompletionCopy,
  type CompletionDeliveryMode,
  type CompletionOutcome,
  type CompletionPreviewMode,
} from '@shared/completion-preview'
import { normalizeSessionFilePath, sessionFilePathsEqual } from '@shared/session-file-path'

export type CompletionNotificationSettings = {
  soundEnabled: boolean
  notificationEnabled: boolean
  alertOnRunIdle: boolean
  alertOnBackgroundRunIdle: boolean
  alertOnRunFailed: boolean
  alertOnCancelled: boolean
  timeoutSeconds: number
  previewMode: CompletionPreviewMode
  onlyWhenUnfocused: boolean
  dndUntil: number | null
  delivery: CompletionDeliveryMode
  language: 'zh' | 'en'
}

export type CompletionCard = {
  notificationId: string
  workspaceId: string
  sessionId?: string
  sessionFile?: string
  outcome: CompletionOutcome
  copy: CompletionCopy
  timeoutMs: number
  sound: boolean
  isTest?: boolean
}

export type CompletionDeliverer = (card: CompletionCard) => void

export type CompletionControllerDeps = {
  now: () => number
  delayMs: number
  getSettings: () => CompletionNotificationSettings
  getWindowState: () => { focused: boolean; visible: boolean; minimized: boolean }
  getVisibleSessionFile: () => string | null
  projectLabel: (workspaceId: string) => string
  deliver: CompletionDeliverer
}

type Pending = {
  notificationId: string
  timer: ReturnType<typeof setTimeout>
  event: CompletionEvent
}

const MAX_SEEN = 200

export function createCompletionNotificationController(deps: CompletionControllerDeps) {
  const pending = new Map<string, Pending>()
  const seen = new Set<string>()
  const settledSinceRun = new Set<string>()
  const exitNotified = new Set<string>()
  let seq = 0

  function sessionKey(file?: string | null): string {
    return normalizeSessionFilePath(file)
  }

  function dedupeKey(sessionFile: string | undefined, runId: string | undefined, outcome: CompletionOutcome): string {
    return `${sessionKey(sessionFile)}|${runId || ''}|${outcome}`
  }

  function rememberSeen(key: string): boolean {
    if (seen.has(key)) return false
    seen.add(key)
    if (seen.size > MAX_SEEN) {
      const first = seen.values().next().value
      if (first) seen.delete(first)
    }
    return true
  }

  function cancelPendingForSession(file: string | null | undefined): void {
    const key = sessionKey(file)
    if (!key) return
    for (const [id, item] of pending) {
      if (sessionKey(item.event.sessionFile) === key) {
        clearTimeout(item.timer)
        pending.delete(id)
      }
    }
  }

  function shouldDeliver(event: CompletionEvent, settings: CompletionNotificationSettings): boolean {
    if (event.outcome === 'cancelled' && !settings.alertOnCancelled) return false
    if (event.outcome === 'failed' && !settings.alertOnRunFailed) return false
    if (event.outcome === 'success' && !settings.alertOnRunIdle) return false
    if (settings.dndUntil != null && settings.dndUntil > deps.now()) return false
    if (!settings.notificationEnabled && !settings.soundEnabled) return false

    const win = deps.getWindowState()
    const visible = sessionFilePathsEqual(deps.getVisibleSessionFile(), event.sessionFile)
    const appForeground = win.visible && !win.minimized && win.focused
    if (settings.onlyWhenUnfocused && appForeground && visible) return false
    if (!visible && !settings.alertOnBackgroundRunIdle) return false
    return true
  }

  function cardFromEvent(event: CompletionEvent, settings: CompletionNotificationSettings, notificationId: string): CompletionCard {
    return {
      notificationId,
      workspaceId: event.workspaceId,
      sessionId: event.sessionId,
      sessionFile: event.sessionFile,
      outcome: event.outcome,
      timeoutMs: settings.timeoutSeconds * 1000,
      sound: settings.soundEnabled,
      copy: buildCompletionNotificationCopy({
        language: settings.language,
        outcome: event.outcome,
        promptPreview: event.promptPreview,
        responsePreview: event.responsePreview,
        durationMs: event.durationMs,
        previewMode: settings.previewMode,
        projectLabel: deps.projectLabel(event.workspaceId),
      }),
    }
  }

  function flush(item: Pending): void {
    pending.delete(item.notificationId)
    const settings = deps.getSettings()
    if (!shouldDeliver(item.event, settings)) return
    deps.deliver(cardFromEvent(item.event, settings, item.notificationId))
  }

  function handleCompletion(event: CompletionEvent): void {
    if (event.type !== 'completion' || event.settled !== true) return
    const file = sessionKey(event.sessionFile)
    if (file && exitNotified.has(file)) return
    if (file) settledSinceRun.add(file)
    if (!rememberSeen(dedupeKey(event.sessionFile, event.runId, event.outcome))) return
    const settings = deps.getSettings()
    if (!shouldDeliver(event, settings)) return

    const notificationId = `n-${deps.now()}-${++seq}`
    const timer = setTimeout(() => {
      const item = pending.get(notificationId)
      if (item) flush(item)
    }, deps.delayMs)
    pending.set(notificationId, { notificationId, timer, event })
  }

  function notifyRunStarted(sessionFile: string | null | undefined, _runId?: string): void {
    const file = sessionKey(sessionFile)
    if (!file) return
    settledSinceRun.delete(file)
    exitNotified.delete(file)
    cancelPendingForSession(file)
  }

  function notifyVisibleSessionChanged(sessionFile: string | null | undefined): void {
    const win = deps.getWindowState()
    if (!win.visible || win.minimized) return
    cancelPendingForSession(sessionFile)
  }

  function handleWorkerExitFailure(target: {
    workspaceId: string
    sessionId?: string
    sessionFile?: string | null
  }): void {
    const file = sessionKey(target.sessionFile)
    if (!file || settledSinceRun.has(file) || exitNotified.has(file)) return
    handleCompletion({
      type: 'completion',
      outcome: 'failed',
      settled: true,
      promptPreview: '',
      responsePreview: '',
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      sessionFile: target.sessionFile || undefined,
      runId: `exit:${file}`,
      seq: 0,
      timestamp: deps.now(),
    })
    exitNotified.add(file)
  }

  function deliverTest(): void {
    const settings = deps.getSettings()
    deps.deliver({
      notificationId: `test-${deps.now()}-${++seq}`,
      workspaceId: '',
      outcome: 'success',
      timeoutMs: settings.timeoutSeconds * 1000,
      sound: settings.soundEnabled,
      isTest: true,
      copy: buildCompletionNotificationCopy({
        language: settings.language,
        outcome: 'success',
        previewMode: 'fixed',
        isTest: true,
      }),
    })
  }

  function dispose(): void {
    for (const item of pending.values()) clearTimeout(item.timer)
    pending.clear()
  }

  return {
    handleCompletion,
    notifyRunStarted,
    notifyVisibleSessionChanged,
    handleWorkerExitFailure,
    deliverTest,
    dispose,
  }
}

export type CompletionNotificationController = ReturnType<typeof createCompletionNotificationController>
