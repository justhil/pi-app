import { normalize, resolve } from 'path'

/** Pool key for a bound agent session (normalized absolute path). */
export function normalizeSessionKey(sessionFile: string): string {
  const raw = String(sessionFile || '').trim()
  if (!raw) return ''
  let abs = normalize(resolve(raw))
  // Windows: stable drive letter for map keys
  if (/^[a-zA-Z]:[\\/]/.test(abs)) {
    abs = abs.charAt(0).toUpperCase() + abs.slice(1)
  }
  return abs
}

/** Pool key for workspace-scoped worker (listSessions / getModels without a session). */
export function workspacePoolKey(cwd: string): string {
  const raw = String(cwd || '').trim()
  if (!raw) return 'ws:'
  let abs = normalize(resolve(raw))
  if (/^[a-zA-Z]:[\\/]/.test(abs)) {
    abs = abs.charAt(0).toUpperCase() + abs.slice(1)
  }
  return `ws:${abs}`
}

export function isWorkspacePoolKey(poolKey: string): boolean {
  return String(poolKey || '').startsWith('ws:')
}

export function poolKeyForSlot(sessionFile: string | null | undefined, cwd: string): string {
  const sk = sessionFile ? normalizeSessionKey(sessionFile) : ''
  if (sk) return sk
  return workspacePoolKey(cwd)
}
