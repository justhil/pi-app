import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { configStore } from './config-store'
import { checkGitHubReleaseUpdate } from './github-release-check'

export const APP_UPDATE_AVAILABLE_CHANNEL = 'ipc:app-update-available'

/** 启动后检查 GitHub Releases 是否有新版本（受设置「自动检查更新」控制） */
export function initUpdater(mainWindow: BrowserWindow): void {
  if (configStore.get('autoCheckRegistryUpdates') === false) {
    log.info('[Updater] auto check disabled')
    return
  }

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
      log.info('[Updater] update available:', result.latestVersion, 'current:', result.currentVersion)
      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send(APP_UPDATE_AVAILABLE_CHANNEL, {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        releaseUrl: result.releaseUrl,
      })
    })
    .catch((err) => {
      log.warn('[Updater] check failed:', err)
    })
}