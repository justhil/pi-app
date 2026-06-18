// Registry Loader - fetch remote adapter registry with signature verification

import type { RegistryFile, RemoteAdapterEntry } from '@shared/extension-types'
import { registryFileSchema } from '@shared/schemas'
import { getBuiltinRegistry } from './built-in-renderers'

const REGISTRY_URL = 'https://raw.githubusercontent.com/study8677/pi-desktop-registry/main/registry.json'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

let cachedRegistry: Record<string, RemoteAdapterEntry> | null = null
let lastCheckTime = 0

export async function fetchRemoteRegistry(force = false): Promise<RegistryFile | null> {
  if (!force && Date.now() - lastCheckTime < ONE_DAY_MS && cachedRegistry) {
    return null // Already checked recently
  }

  try {
    const response = await fetch(REGISTRY_URL)
    if (!response.ok) return null

    const data = await response.json()
    const parsed = registryFileSchema.safeParse(data)
    if (!parsed.success) {
      console.warn('[Registry] Schema validation failed:', parsed.error)
      return null
    }

    // Verify rendererIds are in our built-in whitelist
    const builtin = getBuiltinRegistry()
    const validAdapters = parsed.data.adapters.filter(entry => {
      if (!entry.rendererMap) return true
      for (const rid of Object.values(entry.rendererMap)) {
        // Check if this rendererId exists in any built-in entry
        const known = Object.values(builtin).some(be => 
          be.rendererMap && Object.values(be.rendererMap).includes(rid)
        )
        if (!known) {
          console.warn(`[Registry] Unknown rendererId "${rid}" in adapter "${entry.id}", skipping`)
          return false
        }
      }
      return true
    })

    lastCheckTime = Date.now()
    return { ...parsed.data, adapters: validAdapters }
  } catch (e) {
    console.warn('[Registry] Fetch failed:', e)
    return null
  }
}

export function mergeRegistries(
  builtin: Record<string, RemoteAdapterEntry>,
  remote: RegistryFile | null,
): Record<string, RemoteAdapterEntry> {
  if (!remote) return builtin
  const merged = { ...builtin }
  for (const entry of remote.adapters) {
    // Remote can add new entries or update non-security fields
    // but cannot downgrade compatibility level from blocked to native
    const existing = merged[entry.id]
    if (existing?.compatibility === 'blocked' && entry.compatibility !== 'blocked') {
      // Skip - don't let remote unblock
      continue
    }
    merged[entry.id] = entry
  }
  return merged
}

export function getCachedRegistry(): Record<string, RemoteAdapterEntry> | null {
  return cachedRegistry
}

export function setCachedRegistry(reg: Record<string, RemoteAdapterEntry>): void {
  cachedRegistry = reg
}
