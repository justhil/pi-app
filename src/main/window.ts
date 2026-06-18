import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { workerManager } from './worker-manager'

let mainWindow: BrowserWindow | null = null

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    title: 'pi Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Renderer] Process gone: ${details.reason}`)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function destroyWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
  mainWindow = null
}
