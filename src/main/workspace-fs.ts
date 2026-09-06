import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'fs'
import { StringDecoder } from 'node:string_decoder'
import { WORKSPACE_TEXT_MAX_BYTES } from '../../packages/shared/workspace-preview'
import { dirname, join, normalize, relative, resolve, sep } from 'path'

export type WorkspaceFsError = 'missing_root' | 'outside_workspace' | 'not_found' | 'not_a_file' | 'too_large' | 'read_failed'

function normalizeRoot(root: string): string {
  const r = resolve(root.trim())
  if (!existsSync(r)) return r
  try {
    return realpathSync(r)
  } catch (e) {
    return r
  }
}

/** Resolve user path (absolute or relative to root) and ensure it stays under root. */
export function resolvePathUnderWorkspace(root: string, inputPath: string): { ok: true; abs: string } | { ok: false; error: WorkspaceFsError } {
  const rootAbs = normalizeRoot(root)
  if (!root.trim()) return { ok: false, error: 'missing_root' }
  const raw = (inputPath || '').trim() || '.'
  const abs = resolve(rootAbs, raw)
  let absReal = abs
  try {
    if (existsSync(abs)) absReal = realpathSync(abs)
    else {
      let walk = dirname(abs)
      while (walk && walk !== dirname(walk)) {
        if (existsSync(walk)) {
          const parentReal = realpathSync(walk)
          absReal = join(parentReal, abs.slice(walk.length))
          break
        }
        walk = dirname(walk)
      }
    }
  } catch (e) {
    absReal = abs
  }
  const rel = relative(rootAbs, absReal)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
    return { ok: false, error: 'outside_workspace' }
  }
  return { ok: true, abs: absReal }
}

const LIST_DIR_DEFAULT_MAX = 2500

export function workspaceFsListDir(req: { workspaceRoot: string; path?: string; maxEntries?: number; includeDotfiles?: boolean }) {
  const root = String(req.workspaceRoot || '')
  const rel = String(req.path ?? '.')
  const resolved = resolvePathUnderWorkspace(root, rel)
  if (!resolved.ok) return { ok: false as const, error: resolved.error, entries: [] as const }
  const { abs } = resolved
  if (!existsSync(abs)) return { ok: false as const, error: 'not_found' as const, entries: [] as const }
  const st = statSync(abs)
  if (!st.isDirectory()) return { ok: false as const, error: 'not_found' as const, entries: [] as const }
  const rootAbs = normalizeRoot(root)
  const names = readdirSync(abs, { withFileTypes: true })
  const entries = names
    .filter((d) => req.includeDotfiles === true || !d.name.startsWith('.'))
    .map((d) => {
      const childAbs = join(abs, d.name)
      let size: number | undefined
      let mtimeMs: number | undefined
      try {
        const cst = statSync(childAbs)
        if (!d.isDirectory()) size = cst.size
        mtimeMs = cst.mtimeMs
      } catch (e) {
        /* skip meta */
      }
      const relPath = relative(rootAbs, childAbs).split(sep).join('/')
      return {
        name: d.name,
        path: relPath,
        isDirectory: d.isDirectory(),
        size,
        mtimeMs,
      }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  const maxEntries = Math.min(
    Math.max(1, req.maxEntries ?? LIST_DIR_DEFAULT_MAX),
    LIST_DIR_DEFAULT_MAX,
  )
  const totalCount = entries.length
  const truncated = totalCount > maxEntries
  const slice = truncated ? entries.slice(0, maxEntries) : entries
  return { ok: true as const, entries: slice, truncated, totalCount }
}

export function workspaceFsReadText(req: { workspaceRoot: string; path: string; maxBytes?: number }) {
  const root = String(req.workspaceRoot || '')
  const requested = req.maxBytes ?? WORKSPACE_TEXT_MAX_BYTES
  if (!Number.isSafeInteger(requested) || requested < 1) return { ok: false as const, error: 'read_failed' as const }
  const maxBytes = Math.min(requested, WORKSPACE_TEXT_MAX_BYTES)
  const resolved = resolvePathUnderWorkspace(root, String(req.path || ''))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (!existsSync(abs)) return { ok: false as const, error: 'not_found' as const }
  const st = statSync(abs)
  if (!st.isFile()) return { ok: false as const, error: 'not_a_file' as const }
  try {
    const fd = openSync(abs, 'r')
    try {
      const buf = Buffer.alloc(Math.min(st.size, maxBytes))
      const bytesRead = readSync(fd, buf, 0, buf.length, 0)
      const chunk = buf.subarray(0, bytesRead)
      if (chunk.includes(0)) return { ok: false as const, error: 'binary' as const }
      const truncated = bytesRead < st.size
      const decoder = new StringDecoder('utf8')
      const content = decoder.write(chunk) + (truncated ? '' : decoder.end())
      return { ok: true as const, content, size: st.size, truncated }
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    return { ok: false as const, error: 'read_failed' as const }
  }
}

export function workspaceFsCreate(req: { workspaceRoot: string; relativePath: string; isDirectory?: boolean }) {
  const root = String(req.workspaceRoot || '')
  const rel = String(req.relativePath || '').trim()
  if (!rel) return { ok: false as const, error: 'invalid_name' as const }
  const resolved = resolvePathUnderWorkspace(root, rel)
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (existsSync(abs)) return { ok: false as const, error: 'target_exists' as const }
  try {
    if (req.isDirectory) mkdirSync(abs, { recursive: true })
    else {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, '')
    }
    return { ok: true as const }
  } catch {
    return { ok: false as const, error: 'rename_failed' as const }
  }
}

export function workspaceFsRename(req: { workspaceRoot: string; relativePath: string; newName: string }) {
  const root = String(req.workspaceRoot || '')
  const newName = String(req.newName || '').trim()
  if (!newName || newName.includes('/') || newName.includes('\\')) {
    return { ok: false as const, error: 'invalid_name' as const }
  }
  const resolved = resolvePathUnderWorkspace(root, String(req.relativePath || ''))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (!existsSync(abs)) return { ok: false as const, error: 'not_found' as const }
  const parent = dirname(abs)
  const newAbs = join(parent, newName)
  const rootAbs = normalizeRoot(root)
  const relNew = relative(rootAbs, newAbs)
  if (relNew.startsWith('..') || relNew === '..') return { ok: false as const, error: 'outside_workspace' as const }
  if (existsSync(newAbs)) return { ok: false as const, error: 'target_exists' as const }
  try {
    renameSync(abs, newAbs)
    const newRel = relative(rootAbs, realpathSync(newAbs)).split(sep).join('/')
    return { ok: true as const, newRelativePath: newRel }
  } catch (e) {
    return { ok: false as const, error: 'rename_failed' as const }
  }
}