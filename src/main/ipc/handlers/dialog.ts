import { dialog, BrowserWindow } from 'electron'
import { registerHandler } from '../registry'

export function registerDialogHandlers(): void {
  registerHandler('ipc:dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择项目目录' })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择项目目录' })
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
      title: req?.title || '添加附件',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) {
      return { paths: [] as string[] }
    }
    return { paths: result.filePaths }
  })
}