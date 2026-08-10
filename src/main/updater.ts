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
 * Auto-check throttle: one GitHub call per day at most. The release list barely
 * changes, and a 5s+ network round-trip on every app start (especially with slow
 * GitHub access) should never coincide with the user's first interactions.
 */
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Startup update check: never blocks the UI thread beyond scheduling.
 * Failures are logged only — no toast / dialog.
 * Skips versions the user chose to ignore for this machine.
 * Throttled to one attempt per day via configStore.lastUpdateCheckAt.
 */
export function initUpdater(mainWindow: BrowserWindow): void {
  if (configStore.get('autoCheckRegistryUpdates') === false) {
    log.info('[Updater] auto check disabled')
    return
  }
  const lastCheckAt = Number(configStore.get('lastUpdateCheckAt') || 0)
  if (lastCheckAt > 0 && Date.now() - lastCheckAt < UPDATE_CHECK_TTL_MS) {
    log.info('[Updater] auto check skipped (checked within the last 24h)')
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
      .finally(() => {
        // Record every completed attempt (success or failure) so an offline start
        // does not retry GitHub on the very next app launch.
        configStore.set('lastUpdateCheckAt', Date.now())
      })
  })
}
