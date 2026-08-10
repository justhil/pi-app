import { BrowserWindow, app } from 'electron'
import { registerHandler, registerHandlerWithSchema, sendEvent } from '../registry'
import { piSettingsSetSchema, sdkInstallSchema } from '../schemas'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { readPiInfo, readResourceList } from '../../pi-info'
import { readModelsConfig, writeModelsConfig, fetchRemoteModelIds } from '../../pi-models-json'
import { clearGlobalSdkPathCache } from '../../sdk-loader'
import {
  readSdkStatusCached,
  readWslSdkStatusCached,
  listRegistryVersionsCached,
  listRegistryVersions,
  installVersion,
  switchTo,
  isAllowedSdkVersion,
  invalidateSdkManagerCaches,
} from '../../sdk-manager'
import { errorMessage } from '@shared/error-message'
import { confirmSdkSelection } from '../../sdk-selection-transaction'
import { probeSelectedSdk } from '../sdk-session'
import { getAgentRuntimeConfig } from '../../wsl/runtime-config'
import { assertWslSdkAvailable } from '../../wsl/sdk-resolve'

async function restartWorkers(): Promise<void> {
  const cwd = workerManager.cwd || configStore.get('currentProject')
  if (!cwd) return
  await workerManager.stop()
  await workerManager.start(cwd)
}

function rejectActiveTurns(): string | null {
  return workerManager.hasActiveTurns ? '当前有 Agent 正在运行，无法切换 SDK' : null
}

async function verifySelectedSdk(target: 'builtin' | 'global' | 'user') {
  const runtime = getAgentRuntimeConfig()
  if (runtime.mode === 'wsl' && runtime.distro) {
    // WSL 模式：worker 用发行版内 SDK，切换 global = 确认发行版内可解析后重启 worker
    if (target === 'global') {
      const sdk = await assertWslSdkAvailable(runtime.distro)
      return { kind: 'global' as const, version: sdk.version || '' }
    }
    throw new Error('WSL 模式下仅支持全局版本，无法切换到其他环境')
  }
  const active = await probeSelectedSdk(target)
  if (workerManager.lastSdkFallback) throw new Error('Worker 加载目标 SDK 失败并回退到内置环境')
  return active
}

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
    if (!r.ok || !workerManager.isRunning) return r
    try {
      await workerManager.reloadModels()
      return r
    } catch (e) {
      return { ...r, ok: false, error: `模型配置已写入，但重载失败: ${errorMessage(e)}` }
    }
  })

  registerHandler('ipc:pi.models.fetch', async (req) =>
    fetchRemoteModelIds({
      baseUrl: String(req?.baseUrl || ''),
      apiKey: req?.apiKey,
      authHeader: req?.authHeader,
    }),
  )

  registerHandler('ipc:sdk.status', async (req) => {
    const refresh = req?.refresh === true
    if (refresh) clearGlobalSdkPathCache()
    const cachedStatus = readSdkStatusCached(app.getPath('userData'), { refresh })
    const status = { ...cachedStatus, active: { ...cachedStatus.active } }
    status.workerFallback = workerManager.lastSdkFallback
    const runtime = getAgentRuntimeConfig()
    if (runtime.mode === 'wsl' && runtime.distro) {
      const wsl = await readWslSdkStatusCached(runtime.distro, { refresh })
      status.globalVersion = wsl.globalVersion
      status.active = wsl.active
    }
    return status
  })

  registerHandler('ipc:sdk.listAvailable', async (req) => {
    const refresh = req?.refresh === true
    return listRegistryVersionsCached({ refresh })
  })

  registerHandlerWithSchema('ipc:sdk.install', sdkInstallSchema, async (req) => {
    const version = String(req.version || '').trim()
    const activeTurnError = rejectActiveTurns()
    if (activeTurnError) return { ok: false, error: activeTurnError }
    const runtime = getAgentRuntimeConfig()
    if (runtime.mode === 'wsl' && runtime.distro) {
      return { ok: false, error: 'WSL 模式下不支持独立环境安装；请在发行版内直接 npm i -g 管理 SDK 版本' }
    }
    const registry = await listRegistryVersions()
    if (!isAllowedSdkVersion(version, registry)) {
      return { ok: false, error: 'version not in registry list' }
    }
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const userDataDir = app.getPath('userData')
    const previousTarget = readSdkStatusCached(userDataDir, { refresh: true }).active.kind
    try {
      await installVersion(version, (line) => {
        if (win) sendEvent(win, { type: 'sdk-install-progress', version, line })
      })
      invalidateSdkManagerCaches()
      clearGlobalSdkPathCache()
      const active = await confirmSdkSelection({
        target: 'user',
        rollbackTarget: previousTarget === 'user' ? 'builtin' : previousTarget,
        restartWorker: restartWorkers,
        verifySelection: verifySelectedSdk,
        rollbackSelection: switchTo,
      })
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true })
      return { ok: true, active }
    } catch (e: unknown) {
      const error = errorMessage(e)
      if (win) sendEvent(win, { type: 'sdk-install-progress', version, done: true, error })
      return { ok: false, error }
    }
  })

  registerHandler('ipc:sdk.switch', async (req) => {
    const target: 'builtin' | 'global' | 'user' =
      req?.target === 'global' ? 'global' : req?.target === 'user' ? 'user' : 'builtin'
    const activeTurnError = rejectActiveTurns()
    if (activeTurnError) return { ok: false, error: activeTurnError }
    const userDataDir = app.getPath('userData')
    const previousTarget = readSdkStatusCached(userDataDir, { refresh: true }).active.kind
    try {
      await switchTo(target)
      const active = await confirmSdkSelection({
        target,
        rollbackTarget: previousTarget,
        restartWorker: restartWorkers,
        verifySelection: verifySelectedSdk,
        rollbackSelection: switchTo,
      })
      return { ok: true, active }
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
