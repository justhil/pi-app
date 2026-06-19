// Extension Compatibility Layer — v2-only.
// Builtin registry is built from adapter.json (loadAdapterCatalog), not the deleted v1 registry.

import type { ExtensionProbeResult, CompatibilityLevel, RemoteAdapterEntry } from '@shared/extension-types'
import { loadAdapterCatalog } from './adapter-loader.js'

export function getBuiltinRegistry(projectDir?: string): Record<string, RemoteAdapterEntry> {
  const out: Record<string, RemoteAdapterEntry> = {}
  for (const a of loadAdapterCatalog(projectDir).adapters) {
    if (a.tier === 'none') continue
    const compatibility = a.tier === 'native' ? 'native' : a.tier === 'partial' ? 'basic' : 'headless'
    out[a.id] = {
      id: a.id,
      displayName: a.displayName || a.id,
      compatibility,
      match: { tools: a.match?.tools || [], commands: a.match?.commands || [] },
      risk: { level: 'low', message: a.description || '' },
    }
  }
  return out
}

export function evaluateCompatibility(
  probeResult: ExtensionProbeResult,
  registry: Record<string, RemoteAdapterEntry> = getBuiltinRegistry(),
): { level: CompatibilityLevel; adapterId?: string } {
  for (const [adapterId, entry] of Object.entries(registry)) {
    if (entry.match.tools?.some((t) => probeResult.registeredTools.includes(t))) {
      return { level: entry.compatibility as CompatibilityLevel, adapterId }
    }
  }
  if (probeResult.registeredTools.length > 0 || probeResult.registeredCommands.length > 0) {
    return { level: 'blocked' }
  }
  return { level: 'blocked' }
}

export function getRendererId(_adapterId: string, _kind: string): string | null {
  return null
}
