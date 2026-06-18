import { app, Menu, shell, BrowserWindow } from 'electron'
import { createWindow } from './window'
import { registerAllHandlers } from './ipc'
import { initUpdater } from './updater'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { is } from '@electron-toolkit/utils'

function createMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://pi.dev'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  createMenu()
  registerAllHandlers()
  const win = createWindow()
  workerManager.setMainWindow(win)
  initUpdater()

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
