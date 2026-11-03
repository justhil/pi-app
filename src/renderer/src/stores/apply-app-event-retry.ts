import type { SessionScopedAppEvent } from '@shared/app-event-session'
import { useUIStore } from '@renderer/stores/ui-store'

/**
 * Clear the notice when the retried request makes progress or the run ends.
 * pi's auto_retry_end only lands after the whole retried message.
 */
export function endsRetryWait(event: SessionScopedAppEvent): boolean {
  if (event.type === 'message') return event.role === 'assistant' && event.phase === 'delta'
  if (event.type === 'tool') return event.phase === 'start'
  if (event.type === 'run') return event.phase === 'idle' || event.phase === 'failed' || event.phase === 'cancelled'
  return event.type === 'agent_error'
}

export function applyRetryState(event: SessionScopedAppEvent, sessionFile: string): void {
  if (event.type !== 'retry') {
    if (endsRetryWait(event)) useUIStore.getState().setRetryingSession(sessionFile, null)
    return
  }
  const store = useUIStore.getState()
  if (event.phase === 'start') {
    store.setRetryingSession(sessionFile, {
      attempt: event.attempt ?? 1,
      maxAttempts: event.maxAttempts ?? event.attempt ?? 1,
      errorMessage: event.errorMessage ?? '',
      startedAt: event.timestamp,
      delayMs: event.delayMs ?? 0,
    })
  } else {
    store.setRetryingSession(sessionFile, null)
  }
}
