import { shell } from 'electron'
import { configStore, type StoreSchema } from '../../config-store'
import { asrConfigForSettingsResponse, loadAsrConfig, saveAsrConfig } from '../../asr-config-store'
import { getMainWindow } from '../../window'
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
    configStore.set(key, req.value as StoreSchema[typeof key])
    return { key: req.key, value: req.value }
  })

  registerHandler('ipc:app.checkUpdate', async () => {
    const { checkGitHubReleaseUpdate } = await import('../../github-release-check')
    return checkGitHubReleaseUpdate()
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