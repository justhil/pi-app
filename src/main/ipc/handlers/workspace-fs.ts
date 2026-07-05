import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { shell } from 'electron'
import { workspaceFsListDir, workspaceFsReadText, workspaceFsRename, resolvePathUnderWorkspace } from '../../workspace-fs'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  shellOpenPathSchema,
  shellReadImagePreviewSchema,
  shellShowItemSchema,
  workspaceFsListDirSchema,
  workspaceFsReadTextSchema,
  workspaceFsRenameSchema,
} from '../schemas'

const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

function resolveImagePreviewPath(req: { workspaceRoot: string; path: string }):
  | { ok: true; abs: string }
  | { ok: false; error: string } {
  const pathInput = String(req.path || '')
  const root = String(req.workspaceRoot || '').trim()
  if (!root) return { ok: false, error: 'missing_root' }
  const resolved = resolvePathUnderWorkspace(root, pathInput)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  return { ok: true, abs: resolved.abs }
}

export function registerWorkspaceFsHandlers(): void {
  registerHandlerWithSchema('ipc:shell.openPath', shellOpenPathSchema, async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    try {
      await shell.openPath(p)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  registerHandlerWithSchema('ipc:shell.showItemInFolder', shellShowItemSchema, async (req) => {
    const p = String(req.path || '')
    if (!p) return { ok: false }
    shell.showItemInFolder(p)
    return { ok: true }
  })

  registerHandlerWithSchema('ipc:workspace.fs.listDir', workspaceFsListDirSchema, async (req) => {
    return workspaceFsListDir({
      workspaceRoot: req.workspaceRoot,
      path: req.path != null ? req.path : '.',
    })
  })

  registerHandlerWithSchema('ipc:workspace.fs.readText', workspaceFsReadTextSchema, async (req) => {
    return workspaceFsReadText({
      workspaceRoot: req.workspaceRoot,
      path: req.path,
      maxBytes: req.maxBytes,
    })
  })

  registerHandlerWithSchema('ipc:workspace.fs.rename', workspaceFsRenameSchema, async (req) => {
    return workspaceFsRename({
      workspaceRoot: req.workspaceRoot,
      relativePath: req.relativePath,
      newName: req.newName,
    })
  })

  registerHandlerWithSchema('ipc:shell.readImagePreview', shellReadImagePreviewSchema, async (req) => {
    const resolved = resolveImagePreviewPath(req)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.abs
    if (!existsSync(p)) return { ok: false, error: 'not_found' }
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