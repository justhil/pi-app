import { registerHandler } from '../registry'
import { getMainWindow } from '../../window'

export function registerWindowControlHandlers(): void {
  registerHandler('ipc:window:minimize', async () => {
    getMainWindow()?.minimize()
    return { ok: true }
  })

  registerHandler('ipc:window:maximize', async () => {
    const win = getMainWindow()
    if (!win) return { maximized: false }
    if (win.isMaximized()) {
      win.unmaximize()
      return { maximized: false }
    }
    win.maximize()
    return { maximized: true }
  })

  registerHandler('ipc:window:close', async () => {
    getMainWindow()?.close()
    return { ok: true }
  })

  registerHandler('ipc:window:isMaximized', async () => {
    return { maximized: getMainWindow()?.isMaximized() ?? false }
  })
}