import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'
import type { SessionScopedAppEvent } from '@shared/app-event-session'

const abortUiHoldUntil = new Map<string, number>()
const abortQueueIgnoreUntil = new Map<string, number>()

function isSessionTimerActive(
  timers: Map<string, number>,
  sessionFile: string | null | undefined,
): boolean {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return false
  const until = timers.get(key) ?? 0
  if (Date.now() < until) return true
  timers.delete(key)
  return false
}

export function markAbortUiHold(sessionFile: string, ms = 2800): void {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return
  abortUiHoldUntil.set(key, Date.now() + ms)
}

export function isAbortUiHoldActive(sessionFile: string | null | undefined): boolean {
  return isSessionTimerActive(abortUiHoldUntil, sessionFile)
}

export function clearAbortUiHold(sessionFile?: string): void {
  const key = normalizeSessionFileKey(sessionFile)
  if (key) abortUiHoldUntil.delete(key)
  else abortUiHoldUntil.clear()
}

export function markAbortQueueIgnore(sessionFile: string, ms = 5000): void {
  const key = normalizeSessionFileKey(sessionFile)
  if (!key) return
  abortQueueIgnoreUntil.set(key, Date.now() + ms)
}

export function isAbortQueueIgnoreActive(
  sessionFile: string | null | undefined,
): boolean {
  return isSessionTimerActive(abortQueueIgnoreUntil, sessionFile)
}

export function clearAbortQueueIgnore(sessionFile?: string): void {
  const key = normalizeSessionFileKey(sessionFile)
  if (key) abortQueueIgnoreUntil.delete(key)
  else abortQueueIgnoreUntil.clear()
}

export function shouldIgnoreAppEventAfterAbort(event: SessionScopedAppEvent): boolean {
  const sessionFile = event.sessionFile
  if (!sessionFile) return false

  if (event.type === 'message' && event.role === 'assistant') {
    return isAbortUiHoldActive(sessionFile)
  }
  if (event.type === 'run' && (event.phase === 'started' || event.phase === 'running')) {
    return (
      isAbortUiHoldActive(sessionFile) ||
      (event.phase === 'running' && isAbortQueueIgnoreActive(sessionFile))
    )
  }
  if (event.type === 'queue' && isAbortQueueIgnoreActive(sessionFile)) {
    return event.steering.length > 0 || event.followUp.length > 0
  }
  return false
}
