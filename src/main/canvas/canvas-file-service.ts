import { watch, type FSWatcher } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { CANVAS_EVENT_CHANNEL } from '@shared/canvas-types'
import { wslPathToWindows } from '@shared/wsl-path'
import { resolvePathUnderWorkspace } from '../workspace-fs'
import { getAgentRuntimeConfig } from '../wsl/runtime-config'
import { getMainWindow } from '../window'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_WATCHERS = 16
const WATCH_DEBOUNCE_MS = 150

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
}

function normalizeInputPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (process.platform !== 'win32' || !trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return trimmed
  }
  const runtime = getAgentRuntimeConfig()
  return runtime.mode === 'wsl' ? wslPathToWindows(runtime.distro, trimmed) : trimmed
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  if (!rel) return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolve a canvas `filePath` safely:
 * - Relative paths must reside inside `workspaceRoot` (via `resolvePathUnderWorkspace`).
 * - Absolute paths must reside inside `workspaceRoot`, OS `tmpdir()`, or `~/.pi`.
 */
export async function resolveCanvasFilePath(
  filePath: string,
  workspaceRoot?: string | null,
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  const normalized = normalizeInputPath(filePath)
  if (!normalized) return { ok: false, error: 'empty_path' }

  const root = String(workspaceRoot ?? '').trim()
  if (!isAbsolute(normalized)) {
    if (!root) return { ok: false, error: 'missing_workspace_root' }
    const resolved = await resolvePathUnderWorkspace(root, normalized)
    return resolved.ok ? { ok: true, abs: resolved.abs } : { ok: false, error: resolved.error }
  }

  let realTarget: string
  try {
    realTarget = await realpath(resolve(normalized))
  } catch {
    return { ok: false, error: 'file_not_found' }
  }

  const allowedRoots: string[] = []
  for (const candidateRoot of [root, tmpdir(), resolve(homedir(), '.pi')]) {
    if (!candidateRoot) continue
    try {
      allowedRoots.push(await realpath(candidateRoot))
    } catch {
      /* ignore missing root */
    }
  }

  const allowed = allowedRoots.some((allowedRoot) => isInsideRoot(allowedRoot, realTarget))
  if (!allowed) return { ok: false, error: 'outside_allowed_roots' }
  return { ok: true, abs: realTarget }
}

async function readBounded(absPath: string, maxBytes: number): Promise<Buffer | null> {
  const handle = await open(absPath, 'r')
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

export type CanvasFileReadMode = 'auto' | 'text' | 'image'

export interface CanvasFileReadResult {
  ok: boolean
  absPath?: string
  content?: string
  dataUrl?: string
  mimeType?: string
  mtimeMs?: number
  size?: number
  error?: string
}

export async function readCanvasFile(req: {
  filePath: string
  workspaceRoot?: string | null
  mode?: CanvasFileReadMode
}): Promise<CanvasFileReadResult> {
  const resolved = await resolveCanvasFilePath(req.filePath, req.workspaceRoot)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  try {
    const info = await stat(resolved.abs)
    if (!info.isFile()) return { ok: false, error: 'not_a_file' }
    const ext = extname(resolved.abs).toLowerCase()
    const inferredMime = IMAGE_MIME_BY_EXT[ext]
    const asImage = req.mode === 'image' || (req.mode !== 'text' && Boolean(inferredMime) && ext !== '.svg')

    if (asImage) {
      if (info.size > MAX_IMAGE_BYTES) return { ok: false, error: 'file_too_large' }
      const buf = await readBounded(resolved.abs, MAX_IMAGE_BYTES)
      if (!buf) return { ok: false, error: 'file_too_large' }
      const mimeType = inferredMime || 'image/png'
      return {
        ok: true,
        absPath: resolved.abs,
        dataUrl: `data:${mimeType};base64,${buf.toString('base64')}`,
        mimeType,
        mtimeMs: info.mtimeMs,
        size: buf.length,
      }
    }

    if (info.size > MAX_TEXT_BYTES) return { ok: false, error: 'file_too_large' }
    const buf = await readBounded(resolved.abs, MAX_TEXT_BYTES)
    if (!buf) return { ok: false, error: 'file_too_large' }
    return {
      ok: true,
      absPath: resolved.abs,
      content: buf.toString('utf8'),
      mimeType: ext === '.svg' ? 'image/svg+xml' : 'text/plain',
      mtimeMs: info.mtimeMs,
      size: buf.length,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

interface WatchEntry {
  watchId: string
  filePath: string
  absPath: string
  workspaceRoot?: string | null
  mode: CanvasFileReadMode
  watcher: FSWatcher
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const activeWatchers = new Map<string, WatchEntry>()

export async function watchCanvasFile(req: {
  watchId: string
  filePath: string
  workspaceRoot?: string | null
  mode?: CanvasFileReadMode
}): Promise<{ ok: boolean; absPath?: string; error?: string }> {
  unwatchCanvasFile(req.watchId)

  const resolved = await resolveCanvasFilePath(req.filePath, req.workspaceRoot)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  if (activeWatchers.size >= MAX_WATCHERS) {
    const oldest = activeWatchers.keys().next().value
    if (oldest) unwatchCanvasFile(oldest)
  }

  const targetDir = dirname(resolved.abs)
  const targetName = basename(resolved.abs).toLowerCase()
  const mode: CanvasFileReadMode = req.mode ?? 'auto'

  try {
    // Watch the parent directory and filter by filename so atomic rename saves still trigger hot reload.
    const watcher = watch(targetDir, { persistent: false }, (_eventType, changedName) => {
      if (changedName && changedName.toString().toLowerCase() !== targetName) return
      const entry = activeWatchers.get(req.watchId)
      if (!entry) return
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null
        void readCanvasFile({
          filePath: entry.filePath,
          workspaceRoot: entry.workspaceRoot,
          mode: entry.mode,
        }).then((res) => {
          const win = getMainWindow()
          if (!win || win.isDestroyed()) return
          win.webContents.send(CANVAS_EVENT_CHANNEL, {
            type: 'canvas-file-changed',
            watchId: entry.watchId,
            filePath: entry.filePath,
            ...(res.ok
              ? { content: res.content, dataUrl: res.dataUrl, mtimeMs: res.mtimeMs }
              : { error: res.error }),
          })
        })
      }, WATCH_DEBOUNCE_MS)
    })

    watcher.on('error', () => {
      unwatchCanvasFile(req.watchId)
    })

    activeWatchers.set(req.watchId, {
      watchId: req.watchId,
      filePath: req.filePath,
      absPath: resolved.abs,
      workspaceRoot: req.workspaceRoot,
      mode,
      watcher,
      debounceTimer: null,
    })

    return { ok: true, absPath: resolved.abs }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function unwatchCanvasFile(watchId: string): boolean {
  const entry = activeWatchers.get(watchId)
  if (!entry) return false
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  try {
    entry.watcher.close()
  } catch {
    /* ignore close error */
  }
  activeWatchers.delete(watchId)
  return true
}

export function unwatchAllCanvasFiles(): void {
  for (const id of [...activeWatchers.keys()]) {
    unwatchCanvasFile(id)
  }
}
