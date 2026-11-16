import { writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import {
  MAX_CUSTOM_CSS_LENGTH,
  normalizeCustomTheme,
  WINDOW_MATERIALS,
  type ThemeWindowMaterial,
} from '@shared/custom-theme'
import { registerHandler } from '../registry'
import {
  deleteCssSnippet,
  deleteThemePack,
  importThemePackFromPath,
  listCssSnippets,
  listThemePacks,
  patchCssSnippet,
  sanitizeSlugId,
  saveCssSnippet,
  saveThemePack,
} from '../../theme-library'
import { applyBrowserWindowMaterial } from '../../window-material'
import { getMainWindow } from '../../window'

const themesDir = () => join(app.getPath('userData'), 'themes')
const snippetsDir = () => join(app.getPath('userData'), 'snippets')

export function registerThemeLibraryHandlers(): void {
  registerHandler('ipc:themeLibrary.list', async () => {
    return { items: await listThemePacks(themesDir()) }
  })

  registerHandler('ipc:themeLibrary.save', async (req) => {
    const item = await saveThemePack(themesDir(), {
      id: typeof req?.id === 'string' ? req.id : undefined,
      name: String(req?.name || 'Custom Theme'),
      theme: normalizeCustomTheme(req?.theme),
      customCss: typeof req?.customCss === 'string' ? req.customCss : undefined,
    })
    return { item }
  })

  registerHandler('ipc:themeLibrary.delete', async (req) => {
    const ok = await deleteThemePack(themesDir(), String(req?.id || ''))
    return { ok }
  })

  registerHandler('ipc:themeLibrary.importFile', async () => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: 'Pi Theme Pack', extensions: ['json'] }],
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'canceled' }
    return importThemePackFromPath(themesDir(), res.filePaths[0])
  })

  registerHandler('ipc:themeLibrary.exportFile', async (req) => {
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    const defaultName = `${sanitizeSlugId(String(req?.name || 'pi-theme'), 'pi-theme')}.json`
    const opts = {
      defaultPath: defaultName,
      filters: [{ name: 'Pi Theme Pack', extensions: ['json'] }],
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false, error: 'canceled' }
    const payload = {
      name: String(req?.name || 'Custom Theme').trim().slice(0, 60),
      updatedAt: Date.now(),
      theme: normalizeCustomTheme(req?.theme),
      ...(typeof req?.customCss === 'string' && req.customCss.trim()
        ? { customCss: req.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH) }
        : {}),
    }
    await writeFile(res.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true }
  })

  registerHandler('ipc:snippets.list', async () => {
    return { items: await listCssSnippets(snippetsDir()) }
  })

  registerHandler('ipc:snippets.save', async (req) => {
    const item = await saveCssSnippet(snippetsDir(), {
      id: typeof req?.id === 'string' ? req.id : undefined,
      name: String(req?.name || 'Snippet'),
      css: String(req?.css || ''),
      enabled: req?.enabled,
    })
    return { item }
  })

  registerHandler('ipc:snippets.patch', async (req) => {
    const item = await patchCssSnippet(snippetsDir(), {
      id: String(req?.id || ''),
      enabled: req?.enabled,
      values: req?.values,
      css: req?.css,
      name: req?.name,
    })
    return { item }
  })

  registerHandler('ipc:snippets.delete', async (req) => {
    const ok = await deleteCssSnippet(snippetsDir(), String(req?.id || ''))
    return { ok }
  })

  registerHandler('ipc:window.setMaterial', async (req) => {
    const raw = req?.material
    const mat: ThemeWindowMaterial =
      typeof raw === 'string' && (WINDOW_MATERIALS as readonly string[]).includes(raw)
        ? (raw as ThemeWindowMaterial)
        : 'none'
    const win = BrowserWindow.getFocusedWindow() || getMainWindow()
    return applyBrowserWindowMaterial(win, mat)
  })
}
