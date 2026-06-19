// Extension Compatibility Layer

import type { ExtensionProbeResult, CompatibilityLevel, RemoteAdapterEntry } from '@shared/extension-types'

import { ADAPTERS } from './adapters-registry.js'

function entryFromAdapter(id: string): RemoteAdapterEntry | null {
  const a = ADAPTERS[id]
  if (!a || id === 'ui-bridge') return null
  const compatibility = a.tier === 'native' ? 'native' : a.tier === 'partial' ? 'basic' : 'headless'
  return {
    id: a.id,
    displayName: a.displayName,
    compatibility,
    match: { tools: a.tools },
    risk: { level: 'low', message: a.desktopSupport },
  }
}

const BUILTIN_REGISTRY: Record<string, RemoteAdapterEntry> = Object.fromEntries(
  ['trellis', 'ask', 'image', 'doc', 'repl', 'intercom', 'subagent']
    .map((id) => {
      const e = entryFromAdapter(id)
      return e ? [id, e] as const : null
    })
    .filter(Boolean) as [string, RemoteAdapterEntry][],
)

export function evaluateCompatibility(
  probeResult: ExtensionProbeResult,
  registry: Record<string, RemoteAdapterEntry> = BUILTIN_REGISTRY,
): { level: CompatibilityLevel; adapterId?: string } {
  for (const [adapterId, entry] of Object.entries(registry)) {
    if (entry.match.tools?.some(t => probeResult.registeredTools.includes(t))) {
      return { level: entry.compatibility as CompatibilityLevel, adapterId }
    }
  }
  // No match found - check if it has any tools at all
  if (probeResult.registeredTools.length > 0 || probeResult.registeredCommands.length > 0) {
    return { level: 'blocked' }
  }
  return { level: 'blocked' }
}

export function getBuiltinRegistry(): Record<string, RemoteAdapterEntry> {
  return BUILTIN_REGISTRY
}

export function getRendererId(adapterId: string, kind: string): string | null {
  const entry = BUILTIN_REGISTRY[adapterId]
  if (!entry?.rendererMap) return null
  return entry.rendererMap[kind] || null
}
