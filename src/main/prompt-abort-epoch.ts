import { normalizeSessionKey } from './worker-session-key'

const abortEpochBySession = new Map<string, number>()

export function getPromptAbortEpoch(sessionFile: string | null | undefined): number {
  const key = sessionFile ? normalizeSessionKey(sessionFile) : ''
  return key ? (abortEpochBySession.get(key) ?? 0) : 0
}

export function bumpPromptAbortEpoch(sessionFile: string | null | undefined): number {
  const key = sessionFile ? normalizeSessionKey(sessionFile) : ''
  if (!key) return 0
  const next = (abortEpochBySession.get(key) ?? 0) + 1
  abortEpochBySession.set(key, next)
  return next
}
