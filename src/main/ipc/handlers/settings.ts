import { shell } from 'electron'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { configStore, type StoreSchema } from '../../config-store'
import { asrConfigForSettingsResponse, loadAsrConfig, saveAsrConfig } from '../../asr-config-store'
import { getMainWindow } from '../../window'
import { invalidateAdapterCatalog } from '../../../extension-compat/adapter-loader'
import { workerManager } from '../../worker-manager'
import { invalidateSdkManagerCaches } from '../../sdk-manager'
import { invalidateListSessionsCache } from '../sdk-session'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { settingsSetSchema } from '../schemas'

export function registerSettingsHandlers(): void {
  registerHandler('ipc:settings.get', async (req) => {
    if (req.key) {
      const key = req.key as keyof StoreSchema
      if (key === 'asrConfig') {
        return { settings: { asrConfig: asrConfigForSettingsResponse(loadAsrConfig()) } }
      }
      return { settings: { [req.key]: configStore.get(key) } }
    }
    const all = { ...configStore.getAll() }
    all.asrConfig = asrConfigForSettingsResponse(loadAsrConfig())
    return { settings: all }
  })

  registerHandlerWithSchema('ipc:settings.set', settingsSetSchema, async (req) => {
    const key = req.key as keyof StoreSchema
    if (key === 'asrConfig') {
      saveAsrConfig(req.value as StoreSchema['asrConfig'])
      return { key: req.key, value: asrConfigForSettingsResponse(loadAsrConfig()) }
    }
    if (key === 'agentRuntime') {
      const current = configStore.get('agentRuntime')
      const next = req.value as StoreSchema['agentRuntime']
      const changed = current?.mode !== next.mode || current?.distro !== next.distro
      if (changed) {
        if (workerManager.hasActiveTurns) throw new Error('AGENT_RUNTIME_BUSY')
        await workerManager.stop()
      }
      configStore.set(key, next)
      if (changed) {
        invalidateAdapterCatalog()
        invalidateSdkManagerCaches()
        invalidateListSessionsCache()
      }
      return { key: req.key, value: next }
    }
    configStore.set(key, req.value as StoreSchema[typeof key])
    return { key: req.key, value: req.value }
  })

  registerHandler('ipc:app.checkUpdate', async () => {
    const { checkGitHubReleaseUpdate } = await import('../../github-release-check')

    try {
      const result = await checkGitHubReleaseUpdate()
      if (!result.ok) return { status: 'error' }
      if (!result.hasUpdate || !result.latestVersion) {
        return {
          status: 'up-to-date',
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion ?? result.currentVersion,
        }
      }

      const update: AppUpdateAvailableInfo = {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion.replace(/^v/i, ''),
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes,
        downloadUrl: result.downloadUrl,
        downloadName: result.downloadName,
        assets: result.assets,
      }
      return { status: 'available', update }
    } catch {
      return { status: 'error' }
    }
  })

  registerHandler('ipc:app.getPendingUpdate', async () => {
    const { getPendingAppUpdate } = await import('../../updater')
    return { update: getPendingAppUpdate() }
  })

  registerHandler('ipc:app.dismissUpdatePrompt', async () => {
    const { clearPendingAppUpdate } = await import('../../updater')
    clearPendingAppUpdate()
    return { ok: true }
  })

  registerHandler('ipc:app.openRelease', async (req) => {
    const slug = (process.env.PI_DESKTOP_GITHUB_REPO || 'justhil/pi-app').trim()
    const url = (req.url && String(req.url).trim()) || `https://github.com/${slug}/releases`
    await shell.openExternal(url)
    return { ok: true }
  })

  registerHandler('ipc:app.ignoreUpdateVersion', async (req) => {
    const version = String(req.version || '')
      .trim()
      .replace(/^v/i, '')
    configStore.set('ignoredUpdateVersion', version)
    const { clearPendingAppUpdate } = await import('../../updater')
    clearPendingAppUpdate()
    return { ok: true }
  })

  registerHandler('ipc:app.downloadUpdate', async (req) => {
    const { downloadAndLaunchUpdate } = await import('../../app-update-download')
    return downloadAndLaunchUpdate({
      url: String(req.url || ''),
      fileName: String(req.fileName || 'update.bin'),
    })
  })

  registerHandler('ipc:alerts.signal', async (req) => {
    const { traceAudio } = await import('../../audio-trace')
    traceAudio('ipc.alerts.signal', {
      kind: req.kind,
      title: req.title,
      body: String(req.body || '').slice(0, 80),
    })
    const { deliverDesktopAlert } = await import('../../desktop-alerts')
    const win = getMainWindow()
    const kind = req.kind === 'run_idle' ? 'run_idle' : 'extension_ui'
    deliverDesktopAlert(win, {
      kind,
      title: String(req.title || 'pi Desktop'),
      body: String(req.body || ''),
      background: req.background === true,
    })
    return { ok: true }
  })
}