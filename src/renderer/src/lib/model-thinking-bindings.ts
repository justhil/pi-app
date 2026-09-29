import { ipcClient } from '@renderer/lib/ipc-client'

/**
 * Per-model thinking binding, stored as pi's global `modelThinkingLevels` (`provider/modelId` →
 * level). Switching to a bound model applies its level (the Worker does it for live sessions;
 * this cache lets draft sessions preview it). Shared with pi ≥ 0.84 in the terminal.
 */
let cache: Record<string, string> | null = null
let inflight: Promise<Record<string, string>> | null = null
const listeners = new Set<() => void>()

function normalize(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() && key.includes('/')) out[key] = value.trim().toLowerCase()
  }
  return out
}

export function loadModelThinkingBindings(force = false): Promise<Record<string, string>> {
  if (cache && !force) return Promise.resolve(cache)
  if (inflight && !force) return inflight
  inflight = ipcClient
    .invoke('pi.settings.get')
    .then((res) => {
      cache = normalize((res?.settings as { modelThinkingLevels?: unknown } | null)?.modelThinkingLevels)
      listeners.forEach((listener) => listener())
      return cache
    })
    .catch(() => cache ?? {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function peekModelThinkingBindings(): Record<string, string> {
  return cache ?? {}
}

export function boundThinkingLevelFor(modelKey: string | null | undefined): string | undefined {
  if (!modelKey) return undefined
  return cache?.[modelKey]
}

export function subscribeModelThinkingBindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Replace the whole map (Settings page) or one entry (`level: null` removes it). */
export async function saveModelThinkingBindings(next: Record<string, string>): Promise<void> {
  const res = await ipcClient.invoke('pi.settings.set', { patch: { modelThinkingLevels: next } })
  if (res?.ok === false) throw new Error(String(res.error || 'SAVE_FAILED'))
  cache = { ...next }
  listeners.forEach((listener) => listener())
}

export async function setModelThinkingBinding(modelKey: string, level: string | null): Promise<void> {
  const current = { ...(await loadModelThinkingBindings()) }
  if (level) current[modelKey] = level
  else delete current[modelKey]
  await saveModelThinkingBindings(current)
}
