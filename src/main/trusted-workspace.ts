import { isAbsolute, posix, resolve } from 'path'
import { isWslWindowsPath, windowsPathToWsl, wslWindowsPathDistro } from '@shared/wsl-path'
import { configStore } from './config-store'
import { readSessionMetaFromFile } from './session-file-meta'
import { workerManager } from './worker-manager'
import { getAgentRuntimeConfig } from './wsl/runtime-config'

/** Active workspace root for capability-bound IPC (git mutations, image preview). */
export function getTrustedWorkspaceRoot(): string | null {
  const raw = workerManager.cwd || configStore.get('currentProject')
  const t = typeof raw === 'string' ? raw.trim() : ''
  return t || null
}

export function authorizeTrustedCwd(reqCwd: string | undefined): { ok: true; cwd: string } | { ok: false; error: string } {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) return { ok: false, error: 'no_trusted_workspace' }
  if (!reqCwd || !String(reqCwd).trim()) return { ok: true, cwd: trusted }
  const a = resolve(trusted)
  const b = resolve(String(reqCwd).trim())
  if (a !== b) return { ok: false, error: 'cwd_not_trusted' }
  return { ok: true, cwd: trusted }
}

type TrustedSessionFileResult =
  | { ok: true; cwd: string; sessionFile: string }
  | { ok: false; error: string }

function isPortableAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || isWslWindowsPath(value)
}

function comparableWorkspacePath(value: string): string {
  const wslPath = windowsPathToWsl(null, value).replace(/\\/g, '/')
  const normalized = posix.normalize(wslPath)
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

function workspacePathsEqual(a: string, b: string): boolean {
  const left = comparableWorkspacePath(a)
  const right = comparableWorkspacePath(b)
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(a) || /^[a-zA-Z]:[\\/]/.test(b)
  return windowsPath ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Authorize a renderer-provided session path before opening it in the main process. */
export function authorizeTrustedSessionFile(
  reqCwd: string | undefined,
  requestedSessionFile: string | undefined,
): TrustedSessionFileResult {
  const authorizedCwd = authorizeTrustedCwd(reqCwd)
  if (!authorizedCwd.ok) return authorizedCwd

  const sessionFile = String(requestedSessionFile || '').trim()
  if (!sessionFile || !isPortableAbsolutePath(sessionFile)) {
    return { ok: false, error: 'invalid_session_path' }
  }

  const meta = readSessionMetaFromFile(sessionFile)
  if (!meta?.cwd) return { ok: false, error: 'invalid_session' }
  if (!workspacePathsEqual(meta.cwd, authorizedCwd.cwd)) {
    return { ok: false, error: 'session_workspace_mismatch' }
  }

  const fileDistro = wslWindowsPathDistro(sessionFile)
  const workspaceDistro = wslWindowsPathDistro(authorizedCwd.cwd)
  const activeDistro = getAgentRuntimeConfig().distro
  const expectedDistro = workspaceDistro || activeDistro
  if (fileDistro && expectedDistro && fileDistro.toLowerCase() !== expectedDistro.toLowerCase()) {
    return { ok: false, error: 'session_workspace_mismatch' }
  }

  return { ok: true, cwd: authorizedCwd.cwd, sessionFile }
}
