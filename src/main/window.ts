import { BrowserWindow, nativeImage, shell } from 'electron'
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
import { configStore } from './config-store'
import { workerManager } from './worker-manager'

const MIN_W = 900
const MIN_H = 600
const DEFAULT_W = 1200
const DEFAULT_H = 800

function readSavedWindowBounds(): { width: number; height: number; x?: number; y?: number } | null {
  const b = configStore.get('windowBounds')
  if (!b?.width || !b?.height) return null
  if (b.width < MIN_W || b.height < MIN_H) return null
  return {
    width: Math.round(b.width),
    height: Math.round(b.height),
    x: b.x != null ? Math.round(b.x) : undefined,
    y: b.y != null ? Math.round(b.y) : undefined,
  }
}

export function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const bounds = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds()
  if (bounds.width < MIN_W || bounds.height < MIN_H) return
  configStore.set('windowBounds', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  })
}

function attachWindowBoundsPersistence(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistWindowBounds(win)
    }, 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowBounds(win)
  })
}

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
  const saved = readSavedWindowBounds()
  mainWindow = new BrowserWindow({
    width: saved?.width ?? DEFAULT_W,
    height: saved?.height ?? DEFAULT_H,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_W,
    minHeight: MIN_H,
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

  attachWindowBoundsPersistence(mainWindow)

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
