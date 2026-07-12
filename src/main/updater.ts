import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import type { AppUpdateAvailableInfo } from '@shared/app-update'
import { configStore } from './config-store'
import { checkGitHubReleaseUpdate } from './github-release-check'

export const APP_UPDATE_AVAILABLE_CHANNEL = 'ipc:app-update-available'

/** Last auto-check hit (buffered if renderer subscribed late). Cleared on dismiss / ignore. */
let pendingAppUpdate: AppUpdateAvailableInfo | null = null

function normalizeVersion(version: string): string {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
}

export function getPendingAppUpdate(): AppUpdateAvailableInfo | null {
  return pendingAppUpdate
}

export function clearPendingAppUpdate(): void {
  pendingAppUpdate = null
}

/**
 * Startup update check: never blocks the UI thread beyond scheduling.
 * Failures are logged only — no toast / dialog.
 * Skips versions the user chose to ignore for this machine.
 */
export function initUpdater(mainWindow: BrowserWindow): void {
  if (configStore.get('autoCheckRegistryUpdates') === false) {
    log.info('[Updater] auto check disabled')
    return
  }

  // Extra tick so show/paint is not competing with network
  setImmediate(() => {
    void checkGitHubReleaseUpdate()
      .then((result) => {
        if (!result.ok) {
          if (result.error) log.warn('[Updater] GitHub check:', result.error)
          return
        }
        if (!result.hasUpdate || !result.latestVersion) {
          log.info('[Updater] up to date:', result.currentVersion)
          return
        }

        const latest = normalizeVersion(result.latestVersion)
        const ignored = normalizeVersion(configStore.get('ignoredUpdateVersion') || '')
        if (ignored && ignored === latest) {
          log.info('[Updater] ignored version:', latest)
          return
        }

        log.info('[Updater] update available:', latest, 'current:', result.currentVersion)

        const payload: AppUpdateAvailableInfo = {
          currentVersion: result.currentVersion,
          latestVersion: latest,
          releaseUrl: result.releaseUrl,
          releaseNotes: result.releaseNotes || '',
          downloadUrl: result.downloadUrl,
          downloadName: result.downloadName,
          assets: result.assets,
        }
        pendingAppUpdate = payload

        if (mainWindow.isDestroyed()) return
        mainWindow.webContents.send(APP_UPDATE_AVAILABLE_CHANNEL, payload)
      })
      .catch((err) => {
        log.warn('[Updater] check failed:', err)
      })
  })
}
