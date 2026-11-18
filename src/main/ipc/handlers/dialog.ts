import { dialog, BrowserWindow } from 'electron'
import { mainLabel } from '@shared/main-labels'
import { getMainUiLanguage } from '@shared/main-language'
import { registerHandler } from '../registry'

export function registerDialogHandlers(): void {
  registerHandler('ipc:dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const title = mainLabel(getMainUiLanguage(), 'dialog.openDirectory')
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], title })
    if (result.canceled || result.filePaths.length === 0) {
      return { path: null }
    }
    return { path: result.filePaths[0] }
  })

  registerHandler('ipc:dialog:openFiles', async (req) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const props: ('openFile' | 'multiSelections')[] = ['openFile']
    if (req?.multiple !== false) props.push('multiSelections')
    const opts = {
      properties: props,
      title: req?.title || mainLabel(getMainUiLanguage(), 'dialog.openFiles'),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) {
      return { paths: [] as string[] }
    }
    return { paths: result.filePaths }
  })
}