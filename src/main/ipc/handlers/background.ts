import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { BACKGROUND_EXTENSIONS, backgroundFiles, normalizeBackground } from '@shared/background'
import { configStore } from '../../config-store'
import { importBackgroundImage, pruneBackgroundImages, readBackgroundImage } from '../../background-images'
import { registerHandlerWithSchema } from '../registry'

export const backgroundDir = () => join(app.getPath('userData'), 'backgrounds')

export function registerBackgroundHandlers(): void {
  /** Native picker → copy into app data. Returns the stored file name (the draft keeps it until Save). */
  registerHandlerWithSchema('ipc:background.choose', z.object({}).passthrough(), async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Images', extensions: [...BACKGROUND_EXTENSIONS] }] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'canceled' }
    return importBackgroundImage(backgroundDir(), result.filePaths[0])
  })

  registerHandlerWithSchema('ipc:background.read', z.object({ file: z.string().max(80) }), async (req) => {
    const r = await readBackgroundImage(backgroundDir(), req.file)
    return r ? { ok: true, ...r } : { ok: false }
  })

  void pruneBackgroundImages(backgroundDir(), backgroundFiles(normalizeBackground(configStore.get('background')))).catch(() => {})
}
