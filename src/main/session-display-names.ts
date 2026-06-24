import { normalize, resolve } from 'path'
import { configStore } from './config-store'

export function normalizeSessionFileKey(sessionFile: string): string {
  return normalize(resolve(sessionFile))
}

export function resolveSessionListTitle(sessionFile: string | undefined, sdkTitle: string): string {
  if (!sessionFile) return sdkTitle
  const key = normalizeSessionFileKey(sessionFile)
  const names = configStore.get('sessionDisplayNames') || {}
  const overlay = names[key]?.trim()
  return overlay || sdkTitle
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