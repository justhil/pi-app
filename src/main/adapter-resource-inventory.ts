import type { ResolvedPaths } from '@earendil-works/pi-coding-agent'
import type { ExtensionProbeResult } from '../extension-compat/extension-probe'
import { adapterIdentity } from '../extension-compat/adapter-validation'

export interface RuntimeExtensionCapabilities {
  extensions: Array<{ path: string; source?: string; tools: string[]; commands: string[] }>
  errors: Array<{ path: string; error: string }>
}

export function applyRuntimeCapabilities(probes: ExtensionProbeResult[], runtime: RuntimeExtensionCapabilities): void {
  for (const probe of probes) {
    const identities = [probe.name, probe.packageName, probe.packageSource].filter((name): name is string => !!name).map(adapterIdentity)
    const paths = new Set([probe.mainFilePath, ...(probe.packageResourcePaths ?? [])])
    const loaded = runtime.extensions.filter((extension) => paths.has(extension.path) || identities.includes(adapterIdentity(extension.source || extension.path)))
    const errors = runtime.errors.filter((error) => paths.has(error.path))
    probe.registeredTools = [...new Set(loaded.flatMap((extension) => extension.tools))]
    probe.registeredCommands = [...new Set(loaded.flatMap((extension) => extension.commands))]
    probe.capabilitySource = 'runtime'
    probe.runtimeLoaded = loaded.length > 0
    probe.loadError = errors.length ? errors.map((error) => error.error).join('; ') : undefined
  }
}

export async function annotateExtensionInventory(
  sdk: typeof import('@earendil-works/pi-coding-agent'),
  cwd: string,
  agentDir: string,
  probes: ExtensionProbeResult[],
): Promise<ExtensionProbeResult[]> {
  const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
  const manager = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager })
  // Resolves existing resources without executing extensions or installing missing packages.
  const paths: ResolvedPaths = await manager.resolve(async () => 'skip')
  return probes.map((probe) => {
    const identities = [probe.packageSource, probe.packageName, probe.name].filter((value): value is string => !!value).map(adapterIdentity)
    const resources = paths.extensions.filter((resource) => identities.includes(adapterIdentity(resource.metadata.source)) || resource.path === probe.mainFilePath)
    return {
      ...probe,
      capabilitySource: 'static' as const,
      ...(resources.length ? { enabled: resources.some((resource) => resource.enabled), packageResourcePaths: resources.map((resource) => resource.path) } : {}),
    }
  })
}
