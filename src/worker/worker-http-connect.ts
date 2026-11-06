import { createRequire } from 'node:module'
import { errorMessage } from '@shared/error-message'

/**
 * Node's fetch gives a request 10s to resolve the host and connect, DNS included.
 * A resolver that stalls (for example an IPv6 lookup that goes unanswered behind a
 * TUN proxy) runs past that, so the reply fails with UND_ERR_CONNECT_TIMEOUT and Pi
 * retries into the same stall. 30s lets such a connection finish, only slower.
 */
export const MODEL_CONNECT_TIMEOUT_MS = 30_000

type UndiciModule = {
  Agent: new (options: { connect: { timeout: number } }) => unknown
  setGlobalDispatcher(dispatcher: unknown): void
}

let installedTimeoutMs: number | null = null

export function resolveHttpConnectTimeoutMs(raw: unknown): number {
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(num) && num > 0) return Math.floor(num)
  return MODEL_CONNECT_TIMEOUT_MS
}

/**
 * Install a global dispatcher with a longer connect timeout, built from the undici
 * the active SDK resolves, so it matches the copy Pi loads in either the Windows or
 * the WSL worker. Run after the SDK is imported: loading undici installs a default
 * dispatcher only when none is set yet, so this one is not replaced afterwards.
 */
export function widenHttpConnectTimeout(sdkEntry: string, timeoutMs: unknown = MODEL_CONNECT_TIMEOUT_MS): boolean {
  const resolved = resolveHttpConnectTimeoutMs(timeoutMs)
  if (installedTimeoutMs === resolved) return true
  try {
    const undici = createRequire(sdkEntry)('undici') as UndiciModule
    undici.setGlobalDispatcher(new undici.Agent({ connect: { timeout: resolved } }))
    installedTimeoutMs = resolved
    return true
  } catch (e) {
    console.warn('[Worker] Could not widen the HTTP connect timeout:', errorMessage(e))
    return false
  }
}

export function resetHttpConnectTimeoutForTest(): void {
  installedTimeoutMs = null
}
