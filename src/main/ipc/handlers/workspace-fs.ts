import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { shell } from 'electron'
import { workspaceFsListDir, workspaceFsReadText, workspaceFsRename } from '../../workspace-fs'
import { registerHandler } from '../registry'

const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

export function registerWorkspaceFsHandlers(): void {
  registerHandler('ipc:shell.openPath', async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    try {
      await shell.openPath(p)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  registerHandler('ipc:shell.showItemInFolder', async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    shell.showItemInFolder(p)
    return { ok: true }
  })

  registerHandler('ipc:workspace.fs.listDir', async (req) => {
    return workspaceFsListDir({
      workspaceRoot: String(req?.workspaceRoot || ''),
      path: req?.path != null ? String(req.path) : '.',
    })
  })

  registerHandler('ipc:workspace.fs.readText', async (req) => {
    return workspaceFsReadText({
      workspaceRoot: String(req?.workspaceRoot || ''),
      path: String(req?.path || ''),
      maxBytes: typeof req?.maxBytes === 'number' ? req.maxBytes : undefined,
    })
  })

  registerHandler('ipc:workspace.fs.rename', async (req) => {
    return workspaceFsRename({
      workspaceRoot: String(req?.workspaceRoot || ''),
      relativePath: String(req?.relativePath || ''),
      newName: String(req?.newName || ''),
    })
  })

  registerHandler('ipc:shell.readImagePreview', async (req) => {
    const p = String(req.path || '')
    if (!p || !existsSync(p)) return { ok: false, error: 'not_found' }
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size > IMAGE_PREVIEW_MAX_BYTES) return { ok: false, error: 'too_large' }
      const ext = extname(p).toLowerCase()
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.svg'
                  ? 'image/svg+xml'
                  : 'application/octet-stream'
      const buf = readFileSync(p)
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { ok: true, dataUrl, mimeType: mime }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}