import { open, stat } from 'node:fs/promises'
import { extname } from 'path'
import { shell } from 'electron'
import { workspaceFsCreate, workspaceFsListDir, workspaceFsReadText, workspaceFsRename, resolvePathUnderWorkspace } from '../../workspace-fs'
import { workspaceFsSearch } from '../../workspace-file-search'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  shellOpenPathSchema,
  shellReadImagePreviewSchema,
  shellShowItemSchema,
  workspaceFsListDirSchema,
  workspaceFsSearchSchema,
  workspaceFsReadTextSchema,
  workspaceFsRenameSchema,
  workspaceFsCreateSchema,
} from '../schemas'

const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024

async function resolveImagePreviewPath(req: { workspaceRoot: string; path: string }): Promise<
  | { ok: true; abs: string }
  | { ok: false; error: string }
> {
  const pathInput = String(req.path || '')
  const root = String(req.workspaceRoot || '').trim()
  if (!root) return { ok: false, error: 'missing_root' }
  const resolved = await resolvePathUnderWorkspace(root, pathInput)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  return { ok: true, abs: resolved.abs }
}

/** Read at most `maxBytes`; null when the file holds more (e.g. it grew after the size check). */
async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer | null> {
  const handle = await open(path, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
      if (bytesRead === 0) break
      chunks.push(chunk.subarray(0, bytesRead))
      total += bytesRead
    }
    return total > maxBytes ? null : Buffer.concat(chunks, total)
  } finally {
    await handle.close()
  }
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
      includeDotfiles: req.includeDotfiles === true,
    })
  })

  registerHandlerWithSchema('ipc:workspace.fs.search', workspaceFsSearchSchema, async (req) => {
    return workspaceFsSearch(req)
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

  registerHandlerWithSchema('ipc:workspace.fs.create', workspaceFsCreateSchema, async (req) => {
    return workspaceFsCreate({
      workspaceRoot: req.workspaceRoot,
      relativePath: req.relativePath,
      isDirectory: req.isDirectory === true,
    })
  })

  registerHandlerWithSchema('ipc:shell.readImagePreview', shellReadImagePreviewSchema, async (req) => {
    const resolved = await resolveImagePreviewPath(req)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.abs
    const st = await stat(p).catch(() => null)
    if (!st) return { ok: false, error: 'not_found' }
    try {
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
      const buf = await readBoundedFile(p, IMAGE_PREVIEW_MAX_BYTES)
      if (!buf) return { ok: false, error: 'too_large' }
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      return { ok: true, dataUrl, mimeType: mime }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
}