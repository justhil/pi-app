import { release } from 'node:os'
import type { BrowserWindow } from 'electron'
import type { ThemeWindowMaterial } from '@shared/custom-theme'

function isWin11MaterialSupported(): boolean {
  if (process.platform !== 'win32') return false
  // Windows 11 22H2+ (build >= 22621) supports DWM SystemBackdropType (mica, acrylic, tabbed)
  const parts = release().split('.').map((n) => Number.parseInt(n, 10))
  const build = parts[2] ?? 0
  return parts[0] >= 10 && build >= 22621
}

/**
 * Applies native OS compositor backdrop material dynamically without recreating BrowserWindow.
 * Falls back cleanly to `'none'` on unsupported OS versions so the renderer never paints a black void.
 */
export function applyBrowserWindowMaterial(
  win: BrowserWindow | null,
  requested: ThemeWindowMaterial,
): { ok: boolean; applied: boolean; effective: ThemeWindowMaterial } {
  if (!win || win.isDestroyed()) {
    return { ok: false, applied: false, effective: 'none' }
  }

  if (process.platform === 'win32') {
    if (!isWin11MaterialSupported()) {
      return { ok: true, applied: false, effective: 'none' }
    }
    try {
      if (requested === 'none') {
        win.setBackgroundMaterial('none')
        return { ok: true, applied: true, effective: 'none' }
      }
      win.setBackgroundColor('#00000000')
      win.setBackgroundMaterial(requested)
      return { ok: true, applied: true, effective: requested }
    } catch {
      return { ok: true, applied: false, effective: 'none' }
    }
  }

  if (process.platform === 'darwin') {
    try {
      if (requested === 'none') {
        win.setVibrancy(null)
        return { ok: true, applied: true, effective: 'none' }
      }
      const macMode =
        requested === 'acrylic' ? 'hud' : requested === 'tabbed' ? 'sidebar' : 'under-window'
      win.setVibrancy(macMode)
      return { ok: true, applied: true, effective: requested }
    } catch {
      return { ok: true, applied: false, effective: 'none' }
    }
  }

  return { ok: true, applied: false, effective: 'none' }
}
