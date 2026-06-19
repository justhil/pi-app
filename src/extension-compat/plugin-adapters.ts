// One installed plugin → one desktop adapter entry (adapter id = plugin name)

import type { ExtensionProbeResult } from './extension-probe.js'
import { resolvePluginAdapterMeta, type PluginAdapterTier, type ConfigKey } from './plugin-adapter-meta.js'

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
  tier: PluginAdapterTier
  compatibility: ExtensionProbeResult['compatibility']
  desktopSupport: string
  adapterVersion?: string
  notes?: string
  /** Trace back to pi package / path */
  configKeys?: ConfigKey[]
  configNote?: string
  matchMeta: {
    probeId: string
    npmPackage?: string
    folderName?: string
  }
}

function pluginDisplayName(ext: ExtensionProbeResult): string {
  return ext.packageName || ext.name
}

export function hasRegisteredDesktopAdapter(ext: ExtensionProbeResult): boolean {
  const meta = resolvePluginAdapterMeta(ext.name, ext.packageName)
  return meta != null && meta.tier !== 'none'
}

export function buildPluginAdapters(extensions: ExtensionProbeResult[]): PluginAdapterEntry[] {
  return extensions.filter(hasRegisteredDesktopAdapter).map((ext) => {
    const displayName = pluginDisplayName(ext)
    const meta = resolvePluginAdapterMeta(ext.name, ext.packageName)!

    return {
      id: displayName,
      displayName,
      pluginId: ext.id,
      packageName: ext.packageName,
      version: ext.version,
      source: ext.source,
      description: ext.description,
      registeredTools: ext.registeredTools,
      registeredCommands: ext.registeredCommands,
      enabled: ext.enabled,
      tier: meta.tier,
      compatibility: ext.compatibility,
      desktopSupport: meta.desktopSupport,
      adapterVersion: meta.adapterVersion,
      notes: meta.notes,
      configKeys: meta.configKeys,
      configNote: meta.configNote,
      matchMeta: {
        probeId: ext.id,
        npmPackage: ext.packageName,
        folderName: ext.source !== 'package' ? ext.name : undefined,
      },
    }
  })
}