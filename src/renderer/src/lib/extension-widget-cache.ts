import type { AdapterWidgetProjection } from '@shared/adapter-widget'
import type { ExtensionWidgetEvent } from '@shared/app-events'
import { normalizeSessionFileKey } from '@renderer/lib/session-file-key'

type Cached = { seq: number; state: AdapterWidgetProjection | null }

const cache = new Map<string, Map<string, Cached>>()

function sessionKey(file: string | null | undefined): string {
  return normalizeSessionFileKey(file)
}

export function applyExtensionWidgetEvent(event: ExtensionWidgetEvent): AdapterWidgetProjection | null | undefined {
  const file = sessionKey(event.sessionFile)
  if (!file || !event.widgetKey) return undefined
  const byKey = cache.get(file) ?? new Map<string, Cached>()
  const prev = byKey.get(event.widgetKey)
  if (prev && event.seq < prev.seq) return prev.state
  const next = event.phase === 'clear' ? null : event.state ?? null
  byKey.set(event.widgetKey, { seq: event.seq, state: next })
  cache.set(file, byKey)
  return next
}

export function getSessionComposerWidget(sessionFile: string | null | undefined): AdapterWidgetProjection | null {
  const file = sessionKey(sessionFile)
  if (!file) return null
  const byKey = cache.get(file)
  if (!byKey) return null
  for (const item of byKey.values()) {
    if (item.state) return item.state
  }
  return null
}

export function clearSessionWidgets(sessionFile: string | null | undefined): void {
  const file = sessionKey(sessionFile)
  if (file) cache.delete(file)
}
