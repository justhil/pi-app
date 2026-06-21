import { app, shell, BrowserWindow } from 'electron'
import { createWindow } from './window'
import { registerWindowControlHandlers } from './window-controls'
import { registerAllHandlers } from './ipc'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { is } from '@electron-toolkit/utils'

// Prevent EPIPE / write errors from crashing the main process
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})
process.on('uncaughtException', (err) => {
  // EPIPE is common when worker stdout pipe closes; ignore it
  const code = (err as any)?.code
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return
  console.error('[Main] Uncaught exception:', err)
})

function createMenu(): void {
  // macOS keeps a minimal app menu (system convention); Windows/Linux remove the menu bar entirely.
  if (process.platform === 'darwin') {
    const { Menu } = require('electron')
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
        { role: 'help', submenu: [{ label: 'Documentation', click: () => shell.openExternal('https://pi.dev') }] },
      ] as Electron.MenuItemConstructorOptions[]),
    )
    return
  }
  const { Menu } = require('electron')
  Menu.setApplicationMenu(null)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  if (!gotLock) return
  createMenu()
  registerAllHandlers()
  registerWindowControlHandlers()
  const win = createWindow()
  workerManager.setMainWindow(win)
  win.once('show', () => {
    setTimeout(() => {
      import('./updater').then(({ initUpdater }) => initUpdater()).catch((e) => {
        console.warn('[Updater] Failed to initialize:', e)
      })
    }, 3000)
  })

  // Auto-open last project if exists
  const lastProject = configStore.get('currentProject')
  if (lastProject) {
    workerManager.start(lastProject).then(() => {
      win.webContents.send('ipc:auto-opened', { workspaceId: lastProject })
    }).catch((e) => console.error('Auto-open failed:', e))
  }

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      const w = createWindow()
      workerManager.setMainWindow(w)
    }
  })
})

app.on('window-all-closed', () => {
  workerManager.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
