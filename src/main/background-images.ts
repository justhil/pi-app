import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { BACKGROUND_EXTENSIONS, BACKGROUND_MAX_BYTES } from '@shared/background'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }
const SAFE_FILE = /^[a-f0-9]{16,64}\.(png|jpe?g|webp|gif|avif)$/

export type ImportResult = { ok: true; file: string } | { ok: false; error: 'type' | 'size' | 'read' }

/** Copy a picked image into `dir` under its content hash (same image twice → same file). */
export async function importBackgroundImage(dir: string, source: string): Promise<ImportResult> {
  const ext = extname(source).slice(1).toLowerCase()
  if (!(BACKGROUND_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, error: 'type' }
  try {
    const st = await stat(source)
    if (!st.isFile()) return { ok: false, error: 'read' }
    if (st.size > BACKGROUND_MAX_BYTES) return { ok: false, error: 'size' }
    const hash = createHash('sha1').update(await readFile(source)).digest('hex').slice(0, 24)
    const file = `${hash}.${ext === 'jpeg' ? 'jpg' : ext}`
    await mkdir(dir, { recursive: true })
    await copyFile(source, join(dir, file))
    return { ok: true, file }
  } catch {
    return { ok: false, error: 'read' }
  }
}

/** Image bytes for the renderer (it shows them through a blob: URL, which the CSP allows). */
export async function readBackgroundImage(dir: string, file: string): Promise<{ data: Uint8Array; mime: string } | null> {
  if (!SAFE_FILE.test(file)) return null
  try {
    const data = await readFile(join(dir, file))
    return { data: new Uint8Array(data), mime: MIME[extname(file).slice(1)] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

/** Remove images no setting refers to any more (run at startup, so unsaved picks of the last run go too). */
export async function pruneBackgroundImages(dir: string, keep: string[]): Promise<number> {
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  const live = new Set(keep)
  let removed = 0
  for (const n of names) {
    if (!SAFE_FILE.test(n) || live.has(n)) continue
    await rm(join(dir, n), { force: true })
    removed++
  }
  return removed
}
