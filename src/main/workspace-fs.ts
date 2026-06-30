import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, statSync } from 'fs'
import { dirname, join, normalize, relative, resolve, sep } from 'path'

const READ_TEXT_MAX_BYTES = 1024 * 1024

export type WorkspaceFsError = 'missing_root' | 'outside_workspace' | 'not_found' | 'not_a_file' | 'too_large' | 'read_failed'

function normalizeRoot(root: string): string {
  const r = resolve(root.trim())
  if (!existsSync(r)) return r
  try {
    return realpathSync(r)
  } catch {
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
      const parent = dirname(abs)
      if (existsSync(parent)) {
        const parentReal = realpathSync(parent)
        absReal = join(parentReal, abs.slice(parent.length))
      }
    }
  } catch {
    absReal = abs
  }
  const rel = relative(rootAbs, absReal)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
    return { ok: false, error: 'outside_workspace' }
  }
  return { ok: true, abs: absReal }
}

const LIST_DIR_DEFAULT_MAX = 2500

export function workspaceFsListDir(req: { workspaceRoot: string; path?: string; maxEntries?: number }) {
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
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => {
      const childAbs = join(abs, d.name)
      let size: number | undefined
      let mtimeMs: number | undefined
      try {
        const cst = statSync(childAbs)
        if (!d.isDirectory()) size = cst.size
        mtimeMs = cst.mtimeMs
      } catch {
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
  const maxBytes = Math.min(req.maxBytes ?? READ_TEXT_MAX_BYTES, READ_TEXT_MAX_BYTES)
  const resolved = resolvePathUnderWorkspace(root, String(req.path || ''))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (!existsSync(abs)) return { ok: false as const, error: 'not_found' as const }
  const st = statSync(abs)
  if (!st.isFile()) return { ok: false as const, error: 'not_a_file' as const }
  if (st.size > maxBytes) return { ok: false as const, error: 'too_large' as const }
  try {
    const buf = readFileSync(abs)
    if (buf.length > maxBytes) return { ok: false as const, error: 'too_large' as const }
    return { ok: true as const, content: buf.toString('utf-8'), size: st.size }
  } catch {
    return { ok: false as const, error: 'read_failed' as const }
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
  } catch {
    return { ok: false as const, error: 'rename_failed' as const }
  }
}