import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

export function initUpdater(): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    log.info('No updates available')
  })

  autoUpdater.on('error', (error) => {
    log.error('Update error:', error)
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Download progress: ${progress.percent}%`)
  })

  // Check for updates on startup (non-blocking)
  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('Update check failed:', err)
  })
}
