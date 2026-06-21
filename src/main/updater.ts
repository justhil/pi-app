import pkg from 'electron-updater'
const { autoUpdater } = pkg
import log from 'electron-log'
import { is } from '@electron-toolkit/utils'

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

  if (is.dev || process.env.PI_DESKTOP_AUTO_UPDATE !== '1') return

  autoUpdater.checkForUpdates().catch((err) => {
    log.warn('Update check failed:', err)
  })
}
