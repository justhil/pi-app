import { handleRun } from '@renderer/stores/apply-app-event-run'
import { markSessionTurnEnded } from '@renderer/stores/session-scope'
import { useUIStore } from '@renderer/stores/ui-store'
import type { RunEvent, StoreApi } from '@renderer/stores/apply-app-event-types'

export function handleSessionRun(event: RunEvent, api: StoreApi, sessionFile: string): void {
  const accepted = handleRun(event, api)
  if (accepted && (event.phase === 'running' || event.phase === 'started')) {
    useUIStore.getState().setSessionRuntimeRunning(sessionFile, true)
  } else if (event.phase === 'idle') {
    if (api.get().runState.status === 'idle') {
      useUIStore.getState().setSessionRuntimeRunning(sessionFile, false)
      markSessionTurnEnded(sessionFile, 'idle')
    }
  } else if (event.phase === 'failed' || event.phase === 'cancelled') {
    useUIStore.getState().setSessionRuntimeRunning(sessionFile, false)
    // The session's own markers decide whether a switch-back shows it running.
    markSessionTurnEnded(sessionFile, event.phase === 'failed' ? 'failed' : 'idle')
  }
}
