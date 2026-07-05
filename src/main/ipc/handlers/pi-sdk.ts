import { BrowserWindow, app } from 'electron'
import { registerHandler, registerHandlerWithSchema, sendEvent } from '../registry'
import { piSettingsSetSchema, sdkInstallSchema } from '../schemas'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { readPiInfo, readResourceList } from '../../pi-info'
import { readModelsConfig, writeModelsConfig, fetchRemoteModelIds } from '../../pi-models-json'
import { readSdkStatus, listRegistryVersions, installVersion, switchTo, isAllowedSdkVersion } from '../../sdk-manager'
import { errorMessage } from '@shared/error-message'

export function registerPiSdkHandlers(): void {
  registerHandler('ipc:pi.getInfo', async () => readPiInfo())

  registerHandler('ipc:pi.models.get', async () => {
    const r = await readModelsConfig()
    return {
      path: r.path,
      config: r.config,
      parseError: r.parseError,
      schemaError: r.schemaError,
      warnings: r.warnings,
    }
  })

  registerHandler('ipc:pi.models.set', async (req) => {
    const config = req?.config
    if (!config?.providers || typeof config.providers !== 'object') {
      return { ok: false, path: '', error: '无效 config' }
    }
    const r = await writeModelsConfig(config)
    if (r.ok && workerManager.isRunning) {
      try {
        await workerManager.reloadModels()
      } catch (e) {
        console.error('[IPC] pi.models.set reloadModels failed:', e)
      }
    }
    return r
  })

  registerHandler('ipc:pi.models.fetch', async (req) =>
    fetchRemoteModelIds({
      baseUrl: String(req?.baseUrl || ''),
      apiKey: req?.apiKey,
      authHeader: req?.authHeader,
    }),
  )

  registerHandler('ipc:sdk.status', async () => {
    const status = readSdkStatus(app.getPath('userData'))
    status.workerFallback = workerManager.lastSdkFallback
    return status
  })

  registerHandler('ipc:sdk.listAvailable', async () => listRegistryVersions())

  registerHandlerWithSchema('ipc:sdk.install', sdkInstallSchema, async (req) => {
    const version = String(req.version || '').trim()
    const registry = await listRegistryVersions()
    if (!isAllowedSdkVersion(version, registry)) {
      return { ok: false, error: 'version not in registry list' }
    }
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    try {
      await installVersion(version, (line) => {
        if (win) sendEvent(win, { type: 'sdk-install-progress', version, line })
      })
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true })
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true }
    } catch (e: unknown) {
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true, error: errorMessage(e) })
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:sdk.switch', async (req) => {
    const target: 'builtin' | 'global' | 'user' =
      req?.target === 'global' ? 'global' : req?.target === 'user' ? 'user' : 'builtin'
    try {
      await switchTo(target)
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (cwd) {
        await workerManager.stop()
        await workerManager.start(cwd)
      }
      return { ok: true, active: target }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:pi.settings.get', async () => {
    if (workerManager.isRunning) {
      try {
        return { settings: await workerManager.getPiSettings() }
      } catch (e: unknown) {
        return { settings: null, error: errorMessage(e) }
      }
    }
    const { readPiAgentGlobalSettingsFromDisk } = await import('../../pi-agent-settings-read')
    const disk = readPiAgentGlobalSettingsFromDisk()
    if (disk) return { settings: disk, source: 'agent-settings-json' as const }
    return { settings: null, error: 'Worker not started' }
  })

  registerHandlerWithSchema('ipc:pi.settings.set', piSettingsSetSchema, async (req) => {
    try {
      await workerManager.setPiSettings(req.patch)
      return { ok: true }
    } catch (e: unknown) {
      return { ok: false, error: errorMessage(e) }
    }
  })

  registerHandler('ipc:resources.list', async () => {
    const cwd = workerManager.cwd || configStore.get('currentProject') || process.cwd()
    return readResourceList(cwd)
  })
}