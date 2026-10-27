import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { autoUpdater, type UpdateDownloadedEvent } from 'electron-updater'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { configStore } from './config-store'
import { APP_UPDATE_AVAILABLE_CHANNEL } from './updater'

/**
 * In-place updates from this fork's GitHub releases.
 *
 * The legacy check in `updater.ts` only announces a release and leaves the user to run an
 * installer; here electron-builder's `app-update.yml` points at the fork's release feed, the
 * download happens in the background and the restart applies it.
 */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let updateDownloaded = false

function send(window: BrowserWindow, payload: AppUpdateAvailableInfo): void {
  if (window.isDestroyed()) return
  window.webContents.send(APP_UPDATE_AVAILABLE_CHANNEL, payload)
}

function payloadFor(event: UpdateDownloadedEvent, releaseNotes: string): AppUpdateAvailableInfo {
  return {
    currentVersion: autoUpdater.currentVersion.version,
    latestVersion: event.version,
    releaseUrl: `https://github.com/rabbix07/pi-app/releases/tag/v${event.version}`,
    releaseNotes,
    downloadUrl: null,
    downloadName: null,
    assets: [],
    readyToInstall: true,
  }
}

/** Applies the downloaded update. Called from the update dialog's restart button. */
export function installDownloadedUpdate(): boolean {
  if (!updateDownloaded) return false
  setImmediate(() => autoUpdater.quitAndInstall())
  return true
}

export function initAutoUpdate(window: BrowserWindow): void {
  if (configStore.get('autoCheckRegistryUpdates') === false) {
    log.info('[AutoUpdate] disabled')
    return
  }
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => log.warn('[AutoUpdate] failed:', err))

  autoUpdater.on('update-downloaded', (event) => {
    updateDownloaded = true
    const notes = typeof event.releaseNotes === 'string' ? event.releaseNotes : ''
    log.info('[AutoUpdate] downloaded', event.version)
    send(window, payloadFor(event, notes))
  })

  const check = () => {
    void autoUpdater.checkForUpdates().catch((err) => log.warn('[AutoUpdate] check failed:', err))
  }
  // Not on the paint frame, and not in dev where there is no app-update.yml to read.
  setTimeout(check, 10_000)
  setInterval(check, CHECK_INTERVAL_MS)
}
