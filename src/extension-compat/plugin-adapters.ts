// One installed plugin → one desktop adapter entry.
// v2-only: all metadata comes from adapter.json (adapter-loader), no v1 registry.

import type { ExtensionProbeResult } from './extension-probe.js'
import type { AdapterJson, AdapterTier } from './adapter-schema.js'
import { resolveV2ByPluginName, loadAdapterCatalog } from './adapter-loader.js'

export interface PluginAdapterEntry {
  /** Same as plugin/package display name */
  id: string
  displayName: string
  pluginId: string
  packageName?: string
  version?: string
  source: ExtensionProbeResult['source']
  description?: string
  registeredTools: string[]
  registeredCommands: string[]
  enabled: boolean
  tier: AdapterTier
  compatibility: ExtensionProbeResult['compatibility']
  desktopSupport: string
  /** v2 adapter.json (for renderer config / toolCard) */
  adapterJson?: AdapterJson
  /** Trace back to pi package / path */
  matchMeta: {
    probeId: string
    npmPackage?: string
    folderName?: string
  }
}

function pluginDisplayName(ext: ExtensionProbeResult): string {
  return ext.packageName || ext.name
}

/** A plugin has a desktop adapter iff a v2 adapter.json claims it with tier != 'none'. */
export function hasRegisteredDesktopAdapter(ext: ExtensionProbeResult, cwd?: string): boolean {
  const a = resolveV2ByPluginName(ext.name, ext.packageName, cwd)
  return a != null && a.tier !== 'none'
}

export function buildPluginAdapters(extensions: ExtensionProbeResult[], cwd?: string): PluginAdapterEntry[] {
  return extensions
    .filter((ext) => hasRegisteredDesktopAdapter(ext, cwd))
    .map((ext) => {
      const displayName = pluginDisplayName(ext)
      const adapter = resolveV2ByPluginName(ext.name, ext.packageName, cwd)!
      return {
        id: displayName,
        displayName: adapter.displayName || displayName,
        pluginId: ext.id,
        packageName: ext.packageName,
        version: ext.version,
        source: ext.source,
        description: ext.description || adapter.description,
        registeredTools: ext.registeredTools,
        registeredCommands: ext.registeredCommands,
        enabled: ext.enabled,
        tier: adapter.tier,
        compatibility: ext.compatibility,
        desktopSupport: adapter.description || '',
        adapterJson: adapter,
        matchMeta: {
          probeId: ext.id,
          npmPackage: ext.packageName,
          folderName: ext.source !== 'package' ? ext.name : undefined,
        },
      }
    })
}

/** v2-only adapters not matched by any probed plugin (e.g. installed but undetected). */
export function orphanV2Adapters(probed: ExtensionProbeResult[], cwd?: string): AdapterJson[] {
  const catalog = loadAdapterCatalog(cwd).adapters
  const probedNames = new Set(probed.flatMap((p) => [p.name, p.packageName].filter(Boolean) as string[]))
  return catalog.filter(
    (a) => a.tier !== 'none' && !(a.match?.names || []).some((n) =>
      probedNames.has(n) || [...probedNames].some((p) => p === n || p.endsWith(n) || p.includes(n))),
  )
}
