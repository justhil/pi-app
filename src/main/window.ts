import { BrowserWindow, shell, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const useFrameless = process.platform === 'win32' || isMac || isLinux

function resolveWindowIcon() {
  const candidates = [
    join(process.resourcesPath, 'build', 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../resources/icon.png'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return undefined
}
import { is } from '@electron-toolkit/utils'
import { workerManager } from './worker-manager'

let mainWindow: BrowserWindow | null = null
let rendererReloadAfterCrash = false

/** Renderer sandbox on by default (FMSM iter14). Set `PI_RENDERER_SANDBOX=0` to disable for local debug. */
export function readRendererSandboxEnabled(): boolean {
  const v = process.env.PI_RENDERER_SANDBOX
  if (v === '0' || v === 'false' || v === 'no') return false
  return true
}

/** Playwright / CI smoke: show window immediately, skip slow startup side effects in main. */
export function isE2eTestMode(): boolean {
  const v = process.env.PI_E2E
  return v === '1' || v === 'true' || v === 'yes'
}

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: !useFrameless,
    ...(isMac && useFrameless
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
      : {}),
    title: 'pi Desktop',
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: readRendererSandboxEnabled(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    if (isE2eTestMode()) {
      mainWindow?.show()
    } else if (is.dev) {
      mainWindow?.showInactive()
    } else {
      mainWindow?.show()
    }
  })

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[Renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[Renderer] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Renderer] Process gone: ${details.reason} exitCode=${details.exitCode}`)
    if (details.reason === 'crashed' || details.reason === 'killed' || details.reason === 'oom') {
      void workerManager.stop()
      if (!rendererReloadAfterCrash && mainWindow && !mainWindow.isDestroyed()) {
        rendererReloadAfterCrash = true
        console.error('[Renderer] Reloading once after crash')
        mainWindow.webContents.reload()
      }
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Renderer] Unresponsive')
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
