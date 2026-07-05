import { resolve } from 'path'
import { configStore } from './config-store'
import { workerManager } from './worker-manager'

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