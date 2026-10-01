import { mkdir, open, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { WORKSPACE_TEXT_MAX_BYTES } from '../../packages/shared/workspace-preview'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'

export type WorkspaceFsError = 'missing_root' | 'outside_workspace' | 'not_found' | 'not_a_file' | 'too_large' | 'read_failed'

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function normalizeRoot(root: string): Promise<string> {
  const r = resolve(root.trim())
  try {
    return await realpath(r)
  } catch (e) {
    return r
  }
}

// A different Windows drive or UNC share makes relative() return an absolute path.
function isOutsideRoot(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../') || isAbsolute(rel)
}

/** Real path of `abs`, or of its nearest existing ancestor joined with the missing tail. */
async function realPathOrNearestAncestor(abs: string): Promise<string> {
  try {
    return await realpath(abs)
  } catch (error) {
    if (!isMissing(error)) return abs
  }
  let walk = dirname(abs)
  while (walk && walk !== dirname(walk)) {
    try {
      const parentReal = await realpath(walk)
      return join(parentReal, abs.slice(walk.length))
    } catch (error) {
      if (!isMissing(error)) return abs
    }
    walk = dirname(walk)
  }
  return abs
}

/** Resolve user path (absolute or relative to root) and ensure it stays under root. */
export async function resolvePathUnderWorkspace(root: string, inputPath: string): Promise<{ ok: true; abs: string } | { ok: false; error: WorkspaceFsError }> {
  if (!root.trim()) return { ok: false, error: 'missing_root' }
  const rootAbs = await normalizeRoot(root)
  const raw = (inputPath || '').trim() || '.'
  const abs = resolve(rootAbs, raw)
  const absReal = await realPathOrNearestAncestor(abs)
  if (isOutsideRoot(relative(rootAbs, absReal))) {
    return { ok: false, error: 'outside_workspace' }
  }
  return { ok: true, abs: absReal }
}

const LIST_DIR_DEFAULT_MAX = 2500
/** Bounded metadata fan-out: keeps UNC/WSL shares from receiving thousands of stats at once. */
const LIST_DIR_STAT_CONCURRENCY = 32

async function mapWithConcurrency<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      out[index] = await map(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}

export async function workspaceFsListDir(req: { workspaceRoot: string; path?: string; maxEntries?: number; includeDotfiles?: boolean }) {
  const root = String(req.workspaceRoot || '')
  const rel = String(req.path ?? '.')
  const resolved = await resolvePathUnderWorkspace(root, rel)
  if (!resolved.ok) return { ok: false as const, error: resolved.error, entries: [] as const }
  const { abs } = resolved
  const st = await stat(abs).catch(() => null)
  if (!st?.isDirectory()) return { ok: false as const, error: 'not_found' as const, entries: [] as const }
  const rootAbs = await normalizeRoot(root)
  const names = await readdir(abs, { withFileTypes: true })
  // Order and truncate on Dirent data first; only returned entries pay for a stat.
  const sorted = names
    .filter((d) => req.includeDotfiles === true || !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  const maxEntries = Math.min(
    Math.max(1, req.maxEntries ?? LIST_DIR_DEFAULT_MAX),
    LIST_DIR_DEFAULT_MAX,
  )
  const totalCount = sorted.length
  const truncated = totalCount > maxEntries
  const selected = truncated ? sorted.slice(0, maxEntries) : sorted
  const entries = await mapWithConcurrency(selected, LIST_DIR_STAT_CONCURRENCY, async (d) => {
    const childAbs = join(abs, d.name)
    let size: number | undefined
    let mtimeMs: number | undefined
    try {
      const cst = await stat(childAbs)
      if (!d.isDirectory) size = cst.size
      mtimeMs = cst.mtimeMs
    } catch (e) {
      /* skip meta */
    }
    const relPath = relative(rootAbs, childAbs).split(sep).join('/')
    return {
      name: d.name,
      path: relPath,
      isDirectory: d.isDirectory,
      size,
      mtimeMs,
    }
  })
  return { ok: true as const, entries, truncated, totalCount }
}

export async function workspaceFsReadText(req: { workspaceRoot: string; path: string; maxBytes?: number }) {
  const root = String(req.workspaceRoot || '')
  const requested = req.maxBytes ?? WORKSPACE_TEXT_MAX_BYTES
  if (!Number.isSafeInteger(requested) || requested < 1) return { ok: false as const, error: 'read_failed' as const }
  const maxBytes = Math.min(requested, WORKSPACE_TEXT_MAX_BYTES)
  const resolved = await resolvePathUnderWorkspace(root, String(req.path || ''))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  const st = await stat(abs).catch(() => null)
  if (!st) return { ok: false as const, error: 'not_found' as const }
  if (!st.isFile()) return { ok: false as const, error: 'not_a_file' as const }
  try {
    const handle = await open(abs, 'r')
    try {
      const buf = Buffer.alloc(Math.min(st.size, maxBytes))
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      const chunk = buf.subarray(0, bytesRead)
      if (chunk.includes(0)) return { ok: false as const, error: 'binary' as const }
      const truncated = bytesRead < st.size
      const decoder = new StringDecoder('utf8')
      const content = decoder.write(chunk) + (truncated ? '' : decoder.end())
      return { ok: true as const, content, size: st.size, truncated }
    } finally {
      await handle.close()
    }
  } catch (e) {
    return { ok: false as const, error: 'read_failed' as const }
  }
}

export async function workspaceFsCreate(req: { workspaceRoot: string; relativePath: string; isDirectory?: boolean }) {
  const root = String(req.workspaceRoot || '')
  const rel = String(req.relativePath || '').trim()
  if (!rel) return { ok: false as const, error: 'invalid_name' as const }
  const resolved = await resolvePathUnderWorkspace(root, rel)
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (await pathExists(abs)) return { ok: false as const, error: 'target_exists' as const }
  try {
    if (req.isDirectory) await mkdir(abs, { recursive: true })
    else {
      await mkdir(dirname(abs), { recursive: true })
      // 'wx' keeps the existence check authoritative if the path appeared meanwhile.
      await writeFile(abs, '', { flag: 'wx' })
    }
    return { ok: true as const }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') return { ok: false as const, error: 'target_exists' as const }
    return { ok: false as const, error: 'rename_failed' as const }
  }
}

export async function workspaceFsRename(req: { workspaceRoot: string; relativePath: string; newName: string }) {
  const root = String(req.workspaceRoot || '')
  const newName = String(req.newName || '').trim()
  if (!newName || newName.includes('/') || newName.includes('\\')) {
    return { ok: false as const, error: 'invalid_name' as const }
  }
  const resolved = await resolvePathUnderWorkspace(root, String(req.relativePath || ''))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }
  const { abs } = resolved
  if (!(await pathExists(abs))) return { ok: false as const, error: 'not_found' as const }
  const parent = dirname(abs)
  const newAbs = join(parent, newName)
  const rootAbs = await normalizeRoot(root)
  const relNew = relative(rootAbs, newAbs)
  if (isOutsideRoot(relNew)) return { ok: false as const, error: 'outside_workspace' as const }
  if (await pathExists(newAbs)) return { ok: false as const, error: 'target_exists' as const }
  try {
    await rename(abs, newAbs)
    const newRel = relative(rootAbs, await realpath(newAbs)).split(sep).join('/')
    return { ok: true as const, newRelativePath: newRel }
  } catch (e) {
    return { ok: false as const, error: 'rename_failed' as const }
  }
}