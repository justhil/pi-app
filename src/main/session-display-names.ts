import { normalize, resolve } from 'path'
import { pickSessionListTitle } from '@shared/session-list-title'
import { configStore } from './config-store'

export function normalizeSessionFileKey(sessionFile: string): string {
  return normalize(resolve(sessionFile))
}

export function resolveSessionListTitle(
  sessionFile: string | undefined,
  sdkTitle: string,
  sdkName?: string,
): string {
  let overlay: string | undefined
  if (sessionFile) {
    const key = normalizeSessionFileKey(sessionFile)
    overlay = configStore.get('sessionDisplayNames')?.[key]
  }
  return pickSessionListTitle(sdkTitle, sdkName, overlay)
}

export function setSessionDisplayName(sessionFile: string, title: string): void {
  const key = normalizeSessionFileKey(sessionFile)
  const names = { ...(configStore.get('sessionDisplayNames') || {}) }
  names[key] = title.trim()
  configStore.set('sessionDisplayNames', names)
}

export function clearSessionDisplayName(sessionFile: string): void {
  const key = normalizeSessionFileKey(sessionFile)
  const names = { ...(configStore.get('sessionDisplayNames') || {}) }
  delete names[key]
  configStore.set('sessionDisplayNames', names)
}