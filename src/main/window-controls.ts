import { ipcMain } from 'electron'
import { getMainWindow } from './window'

export function registerWindowControlHandlers(): void {
  ipcMain.handle('ipc:window:minimize', () => {
    getMainWindow()?.minimize()
  })
  ipcMain.handle('ipc:window:maximize', async () => {
    const win = getMainWindow()
    if (!win) return { maximized: false }
    if (win.isMaximized()) {
      win.unmaximize()
      return { maximized: false }
    }
    win.maximize()
    return { maximized: true }
  })
  ipcMain.handle('ipc:window:close', () => {
    getMainWindow()?.close()
  })
  ipcMain.handle('ipc:window:isMaximized', () => {
    return { maximized: getMainWindow()?.isMaximized() ?? false }
  })
}