import { registerHandler } from '../registry'
import { getMainWindow } from '../../window'
import { handleCloseDecision } from '../../window-close-guard'

export function registerWindowControlHandlers(): void {
  registerHandler('ipc:window:close-decision', async (req) => {
    const action = (req as { action?: string } | null)?.action
    if (action !== 'wait' && action !== 'now' && action !== 'cancel') {
      return { ok: false, reason: 'invalid_action' }
    }
    return handleCloseDecision(action)
  })
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