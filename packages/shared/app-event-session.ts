import type { AppEvent } from './app-events'

export type SessionScopedAppEvent = Exclude<AppEvent, { type: 'sdk-install-progress' | 'sdk-runtime-changed' }>

export function isSessionScopedAppEvent(event: AppEvent): event is SessionScopedAppEvent {
  return event.type !== 'sdk-install-progress' && event.type !== 'sdk-runtime-changed'
}

export function appEventSessionId(event: AppEvent): string | undefined {
  if (!isSessionScopedAppEvent(event)) return undefined
  return event.sessionId
}

export function appEventSessionFile(event: AppEvent): string | undefined {
  if (!isSessionScopedAppEvent(event)) return undefined
  return event.sessionFile
}