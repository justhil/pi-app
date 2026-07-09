import './bootstrap-path'
import { app, shell, BrowserWindow, dialog, session, Menu } from 'electron'
import { createWindow } from './window'
import { refreshGitWorkspaceWatch } from './git-workspace-watch'
import { registerAllHandlers } from './ipc'
import { workerManager } from './worker-manager'
import { configStore } from './config-store'
import { is } from '@electron-toolkit/utils'
// Prevent EPIPE / write errors from crashing the main process
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return
  console.error('[Main] Uncaught exception:', err)
  try {
    const win = BrowserWindow.getAllWindows()[0]
    const msg = err instanceof Error ? err.message : String(err)
    const opts = {
      type: 'error' as const,
      title: 'pi Desktop',
      message: 'A critical error occurred. Please restart the app.',
      detail: msg.slice(0, 500),
    }
    if (win && !win.isDestroyed()) void dialog.showMessageBox(win, opts)
    else void dialog.showMessageBox(opts)
  } catch (e) {
    /* dialog unavailable during early boot */
  }
  setTimeout(() => app.quit(), 2000)
})

function createMenu(): void {
  // macOS keeps a minimal app menu (system convention); Windows/Linux remove the menu bar entirely.
  if (process.platform === 'darwin') {
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
  if (process.env.PI_AUDIO_TRACE === '1' || process.env.PI_ALERT_TRACE === '1') {
    void import('./audio-trace').then(({ getAudioTraceLogHint }) => {
      console.log('[audio-trace] enabled — log file:', getAudioTraceLogHint())
    })
  }
  createMenu()

  // CSP: inject Content-Security-Policy header in production (skip dev for Vite HMR)
  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.github.com https://chatgpt.com; font-src 'self' data:"
          ]
        }
      })
    })
  }

  registerAllHandlers()
  void import('./clipboard-temp-images').then(({ pruneStaleClipboardImages }) => {
    try {
      pruneStaleClipboardImages()
    } catch (e) {
      console.warn('[clipboard-images] prune failed:', e)
    }
  })
  const win = createWindow()
  workerManager.setMainWindow(win)
  refreshGitWorkspaceWatch(win)
  if (process.env.PI_E2E !== '1' && process.env.PI_E2E !== 'true') {
    win.once('show', () => {
      setTimeout(() => {
        import('./updater').then(({ initUpdater }) => initUpdater(win)).catch((e) => {
          console.warn('[Updater] Failed to initialize:', e)
        })
      }, 3000)
    })
  }

  // 不自动打开上次项目：进 app 显示空 Project Home，用户自行选择项目

  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      const w = createWindow()
      workerManager.setMainWindow(w)
    }
  })
})

let isQuittingGracefully = false

/**
 * Force-quit mid-stream used to kill workers before abort could write a terminal
 * assistant leaf — reopen then showed empty unrewindable sessions.
 * Await abort+dispose flush on every quit path.
 */
async function gracefulShutdownWorkers(): Promise<void> {
  if (isQuittingGracefully) return
  isQuittingGracefully = true
  try {
    await workerManager.stop()
  } catch (error) {
    console.error('[Main] graceful worker stop failed:', error)
  }
  try {
    const asr = await import('./asr/codex-asr-manager')
    asr.stopBuiltinCodexAsrServe()
  } catch {
    /* optional */
  }
}

app.on('before-quit', (event) => {
  if (isQuittingGracefully) return
  event.preventDefault()
  void gracefulShutdownWorkers().finally(() => {
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // before-quit will flush workers; do not fire-and-forget stop() here
    if (!isQuittingGracefully) {
      void gracefulShutdownWorkers().finally(() => app.quit())
    }
  } else {
    void gracefulShutdownWorkers()
  }
})
