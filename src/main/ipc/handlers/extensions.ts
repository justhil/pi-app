import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { awaitWslVm } from '../../wsl/wsl-env'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { resolveActiveAgentDir } from '../../agent-dir'
import { sessionPreviewProcess } from '../../session-preview-process'
import { invalidateExtensionProbeCache, probeExtensionsShared } from '../../extension-probe-cache'
import { applyRuntimeCapabilities } from '../../adapter-resource-inventory'
import { buildPluginAdapters } from '../../../extension-compat/plugin-adapters'
import { invalidateAdapterCatalog, prepareAdapterCatalog, loadAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { listMissingRuntimePackages, appendMissingGitPackagesToSettings } from '../../pi-packages-sync'
import { errorMessage } from '@shared/error-message'

let installQueue: Promise<unknown> = Promise.resolve()

function runSerializedInstall<T>(task: () => Promise<T>): Promise<T> {
  const next = installQueue.then(task, task)
  installQueue = next.then(() => undefined, () => undefined)
  return next
}

export function registerExtensionHandlers(): void {
  registerHandler('ipc:extensions.list', async (req) => {
    const cwd = req?.workspaceId ?? configStore.get('currentProject') ?? process.cwd()
    const probes = await probeExtensionsShared(cwd, { fresh: true })
    const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
    applyPiSyncToExtensionProbes(cwd, probes)
    const live = await workerManager.getExtensionCapabilities(cwd).catch(() => null)
    if (live) applyRuntimeCapabilities(probes, live)
    return { extensions: probes }
  })

  registerHandler('ipc:extensions.setEnabled', async (req) => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    const extensionId = String(req.extensionId || '')
    const enabled = req.enabled !== false
    const probes = await probeExtensionsShared(cwd)
    const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
    applyPiSyncToExtensionProbes(cwd, probes)
    const ext = probes.find((p) => p.id === extensionId)
    if (!ext?.toggleTarget) {
      return { ok: false, extensionId, enabled, error: '无法同步：未找到扩展或未列入 settings.packages' }
    }
    const { setPiExtensionEnabled } = await import('../../pi-package-resource-toggle.js')
    const r = setPiExtensionEnabled(cwd, ext.toggleTarget, enabled)
    invalidateExtensionProbeCache()
    if (!r.ok) return { ok: false, extensionId, enabled, error: r.error }
    if (workerManager.isRunning) await workerManager.reloadResources().catch(() => {})
    return { ok: true, extensionId, enabled, needsWorkerReload: true }
  })

  registerHandler('ipc:extensions.setOverride', async (req) => {
    const r = await (async () => {
      const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
      const extensionId = String(req.extensionId || '')
      const enabled = req.enabled !== false
      const probes = await probeExtensionsShared(cwd)
      const { applyPiSyncToExtensionProbes } = await import('../../pi-extension-probe-sync.js')
      applyPiSyncToExtensionProbes(cwd, probes)
      const ext = probes.find((p) => p.id === extensionId)
      if (!ext?.toggleTarget) return { ok: false as const, error: 'no toggle target' }
      const { setPiExtensionEnabled } = await import('../../pi-package-resource-toggle.js')
      const result = setPiExtensionEnabled(cwd, ext.toggleTarget, enabled)
      invalidateExtensionProbeCache()
      return result
    })()
    if (!r.ok) configStore.setExtensionOverride(req.extensionId, req.enabled)
    return { extensionId: req.extensionId, enabled: req.enabled }
  })

  registerHandler('ipc:extensions.missingRuntimePackages', async () => ({
    missing: listMissingRuntimePackages(),
  }))

  registerHandler('ipc:extensions.syncGitPackages', async () => {
    const result = appendMissingGitPackagesToSettings()
    invalidateExtensionProbeCache()
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
    await awaitWslVm() // startup: let the WSL VM boot off-thread before sync \\wsl.localhost reads
    if (req?.refresh) {
      invalidateAdapterCatalog()
      invalidateExtensionProbeCache()
    }
    const cwd = req?.workspaceId ?? configStore.get('currentProject') ?? process.cwd()
    await prepareAdapterCatalog(cwd, { refresh: req?.refresh === true })
    const extensions = await probeExtensionsShared(cwd)
    const adapters = buildPluginAdapters(extensions, cwd)
    for (const adapter of loadAdapterCatalog(cwd).adapters.filter((item) => item.kind === 'desktop')) {
      adapters.push({ id: adapter.id, pluginId: `desktop:${adapter.id}`, displayName: adapter.displayName ?? adapter.id, source: 'project', registeredTools: [], registeredCommands: [], enabled: true, tier: adapter.tier, compatibility: 'headless', desktopSupport: adapter.description ?? '', adapterJson: adapter, matchMeta: { probeId: `desktop:${adapter.id}` } })
    }
    return { adapters, errors: loadAdapterCatalog(cwd).errors }
  })

  registerHandlerWithSchema(
    'ipc:extensions.install',
    z.object({
      adapterId: z.string().min(1).max(200),
      scope: z.enum(['global', 'project']).optional(),
      workspaceId: z.string().max(4096).optional(),
    }),
    async (req) =>
      runSerializedInstall(async () => {
        await awaitWslVm()
        const cwd = req.workspaceId?.trim() || workerManager.cwd || configStore.get('currentProject') || process.cwd()
        const local = req.scope === 'project'
        if (local && !req.workspaceId?.trim() && !workerManager.cwd && !configStore.get('currentProject')) {
          return { ok: false, error: '当前未打开项目工作区，无法安装到当前项目' }
        }
        await prepareAdapterCatalog(cwd)
        const adapter = loadAdapterCatalog(cwd).adapters.find((item) => item.id === req.adapterId)
        const source = adapter?.install?.source?.trim()
        if (!adapter || !source) {
          return { ok: false, error: `未找到适配器 ${req.adapterId} 的有效安装源` }
        }
        try {
          const agentDir = resolveActiveAgentDir()
          await sessionPreviewProcess.installExtensionPackage({
            cwd,
            agentDir,
            source,
            local,
          })
          invalidateExtensionProbeCache()
          invalidateAdapterCatalog()
          if (workerManager.isRunning) {
            await workerManager.reloadResources().catch(() => {})
          }
          return { ok: true, source }
        } catch (err) {
          return { ok: false, source, error: errorMessage(err) }
        }
      }),
  )
}