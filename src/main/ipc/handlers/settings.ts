import { shell } from 'electron'
import { configStore, type StoreSchema } from '../../config-store'
import { getMainWindow } from '../../window'
import { registerHandler } from '../registry'

export function registerSettingsHandlers(): void {
  registerHandler('ipc:settings.get', async (req) => {
    if (req.key) {
      const key = req.key as keyof StoreSchema
      return { settings: { [req.key]: configStore.get(key) } }
    }
    return { settings: configStore.getAll() }
  })

  registerHandler('ipc:settings.set', async (req) => {
    const key = req.key as keyof StoreSchema
    configStore.set(key, req.value as StoreSchema[typeof key])
    return { key: req.key, value: req.value }
  })

  registerHandler('ipc:app.checkUpdate', async () => {
    const { checkGitHubReleaseUpdate } = await import('../../github-release-check')
    return checkGitHubReleaseUpdate()
  })

  registerHandler('ipc:app.openRelease', async (req) => {
    const slug = (process.env.PI_DESKTOP_GITHUB_REPO || 'justhil/pi-app').trim()
    const url = (req.url && String(req.url).trim()) || `https://github.com/${slug}/releases`
    await shell.openExternal(url)
    return { ok: true }
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
    })
    return { ok: true }
  })
}