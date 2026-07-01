import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { probeExtensions } from '../../../extension-compat/extension-probe'
import { buildPluginAdapters } from '../../../extension-compat/plugin-adapters'
import { invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { listMissingRuntimePackages, appendMissingGitPackagesToSettings } from '../../pi-packages-sync'

export function registerExtensionHandlers(): void {
  registerHandler('ipc:extensions.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const probes = probeExtensions(cwd)
    const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
    applyPiSyncToExtensionProbes(cwd, probes)
    return { extensions: probes }
  })

  registerHandler('ipc:extensions.setEnabled', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const extensionId = String(req.extensionId || '')
    const enabled = req.enabled !== false
    const probes = probeExtensions(cwd)
    const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
    applyPiSyncToExtensionProbes(cwd, probes)
    const ext = probes.find((p) => p.id === extensionId)
    if (!ext?.toggleTarget) {
      return { ok: false, extensionId, enabled, error: '无法同步：未找到扩展或未列入 settings.packages' }
    }
    const { setPiExtensionEnabled } = await import('../../pi-package-resource-toggle.js')
    const r = setPiExtensionEnabled(cwd, ext.toggleTarget, enabled)
    if (!r.ok) return { ok: false, extensionId, enabled, error: r.error }
    if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
    return { ok: true, extensionId, enabled, needsWorkerReload: true }
  })

  registerHandler('ipc:extensions.setOverride', async (req) => {
    const r = await (async () => {
      const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
      const extensionId = String(req.extensionId || '')
      const enabled = req.enabled !== false
      const probes = probeExtensions(cwd)
      const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
      applyPiSyncToExtensionProbes(cwd, probes)
      const ext = probes.find((p) => p.id === extensionId)
      if (!ext?.toggleTarget) return { ok: false as const, error: 'no toggle target' }
      const { setPiExtensionEnabled } = await import('../../pi-package-resource-toggle.js')
      return setPiExtensionEnabled(cwd, ext.toggleTarget, enabled)
    })()
    if (!r.ok) configStore.setExtensionOverride(req.extensionId, req.enabled)
    return { extensionId: req.extensionId, enabled: req.enabled }
  })

  registerHandler('ipc:extensions.missingRuntimePackages', async () => ({
    missing: listMissingRuntimePackages(),
  }))

  registerHandler('ipc:extensions.syncGitPackages', async () => {
    const result = appendMissingGitPackagesToSettings()
    const cwd = workerManager.cwd || configStore.get('currentProject')
    if (result.added.length > 0 && cwd) {
      try {
        await workerManager.stop()
        await workerManager.start(cwd)
      } catch (e) {
        console.error('[IPC] Worker restart after package sync failed:', e)
      }
    }
    return result
  })

  registerHandler('ipc:adapters.catalog', async (req) => {
    if (req?.refresh) invalidateAdapterCatalog()
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const extensions = probeExtensions(cwd)
    return { adapters: buildPluginAdapters(extensions, cwd) }
  })
}