import type { AppEvent } from '@shared/app-events'
import type { UiRequest } from '@shared/remote'
import type { RemoteTapSink } from './host-port'

/**
 * One-line hooks the desktop calls at its existing event exits (worker-manager, pool,
 * extension UI). With the gateway off there is no sink and every call is a no-op, so the
 * desktop path is unchanged. Sink errors are contained: the remote side must never break
 * desktop delivery.
 */

let sink: RemoteTapSink | null = null

export function setRemoteTapSink(next: RemoteTapSink | null): void {
  sink = next
}

function guard(fn: (s: RemoteTapSink) => void): void {
  const s = sink
  if (!s) return
  try {
    fn(s)
  } catch (error) {
    console.warn('[remote] tap sink failed:', error)
  }
}

export const remoteTap = {
  get active(): boolean {
    return sink !== null
  },
  appEvent(event: AppEvent): void {
    guard((s) => s.appEvent(event))
  },
  /** Raw desktop request (`ExtensionUIRequest` + sessionFile); malformed requests are ignored by the sink. */
  uiRequest(request: unknown): void {
    guard((s) => s.uiRequest(request as UiRequest))
  },
  uiResolved(id: string | undefined, by: 'desktop' | 'remote' | 'system'): void {
    if (!id) return
    guard((s) => s.uiResolved(id, by))
  },
  settingsChanged(key: 'cacheWarming' | 'capabilities', sessionFile?: string): void {
    guard((s) => s.settingsChanged(key, sessionFile))
  },
}
