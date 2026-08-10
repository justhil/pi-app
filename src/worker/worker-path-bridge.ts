/**
 * Worker-side path bridge.
 *
 * The worker always operates on native WSL/Linux paths (cwd, session files).
 * Main/renderer always use the Windows view (`\\wsl.localhost\<distro>\...`).
 * This module translates at the worker boundary so main never has to know the
 * WSL internals. In host mode (no `PI_WSL_DISTRO`) it is a no-op pass-through.
 */

import {
  isWslWindowsPath,
  wslPathToWindows,
  windowsPathToWsl,
} from '@shared/wsl-path'
import { WORKER_WSL_DISTRO_ENV } from '@shared/worker-frame'

export const workerDistro: string | null = (() => {
  const d = process.env[WORKER_WSL_DISTRO_ENV]
  return d && d.trim() ? d.trim() : null
})()

export function isWslWorker(): boolean {
  return workerDistro !== null
}

/** Translate a main-side (Windows) path to the worker's native path. */
export function toWorkerPath(p: string | null | undefined): string {
  if (!p) return ''
  if (!workerDistro) return p
  // windowsPathToWsl handles both WSL UNC paths and drive-letter paths.
  return windowsPathToWsl(workerDistro, p)
}

/** Translate a worker-side (native) path to the main-side Windows view. */
export function toMainPath(p: string | null | undefined): string {
  if (!p) return ''
  if (!workerDistro) return p
  return wslPathToWindows(workerDistro, p)
}

const INCOMING_PATH_KEYS = new Set(['cwd', 'sessionFile'])
const OUTGOING_PATH_KEYS = new Set(['sessionFile', 'busySessionFile'])

/** Deep-translate path fields on an incoming worker request payload. */
export function translateIncomingPaths<T extends Record<string, unknown>>(msg: T): T {
  if (!workerDistro) return msg
  const out: Record<string, unknown> = { ...msg }
  for (const key of Object.keys(out)) {
    if (INCOMING_PATH_KEYS.has(key) && typeof out[key] === 'string') {
      out[key] = toWorkerPath(out[key] as string)
    }
  }
  return out as T
}

/** Deep-translate path fields on an outgoing worker response payload. */
export function translateOutgoingPaths(
  resp: Record<string, unknown>,
): Record<string, unknown> {
  if (!workerDistro) return resp
  const out: Record<string, unknown> = { ...resp }
  for (const key of Object.keys(out)) {
    if (OUTGOING_PATH_KEYS.has(key) && typeof out[key] === 'string') {
      out[key] = toMainPath(out[key] as string)
    }
  }
  if (Array.isArray(out.sessions)) {
    out.sessions = (out.sessions as Record<string, unknown>[]).map((row) => {
      const r: Record<string, unknown> = { ...row }
      if (typeof r.path === 'string') r.path = toMainPath(r.path)
      if (typeof r.sessionFile === 'string') r.sessionFile = toMainPath(r.sessionFile)
      if (typeof r.cwd === 'string') r.cwd = toMainPath(r.cwd)
      return r
    })
  }
  if (out.state && typeof out.state === 'object' && !Array.isArray(out.state)) {
    const state: Record<string, unknown> = { ...(out.state as Record<string, unknown>) }
    if (typeof state.sessionFile === 'string') state.sessionFile = toMainPath(state.sessionFile)
    out.state = state
  }
  return out
}

/** Translate `workspaceId` / `sessionFile` on an app event leaving the worker. */
export function translateEventPaths<T extends object>(event: T): T {
  if (!workerDistro) return event
  const out: Record<string, unknown> = { ...(event as Record<string, unknown>) }
  if (typeof out.workspaceId === 'string') out.workspaceId = toMainPath(out.workspaceId)
  if (typeof out.sessionFile === 'string') out.sessionFile = toMainPath(out.sessionFile)
  return out as T
}
