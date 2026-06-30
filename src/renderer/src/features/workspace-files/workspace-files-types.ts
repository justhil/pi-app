export type FsEntry = {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  mtimeMs?: number
}

export const PI_FILE_PATH_MIME = 'application/x-pi-file-path'

export function setPiFilePathDrag(dt: DataTransfer, path: string, name: string) {
  dt.setData(PI_FILE_PATH_MIME, JSON.stringify({ path, name }))
  dt.setData('text/plain', path)
  dt.effectAllowed = 'copy'
}

export function readPiFilePathDrop(dt: DataTransfer): { path: string; name: string } | null {
  const raw = dt.getData(PI_FILE_PATH_MIME)
  if (raw) {
    try {
      const o = JSON.parse(raw) as { path?: string; name?: string }
      if (o.path) return { path: o.path, name: o.name || o.path.split(/[\\/]/).pop() || o.path }
    } catch {
      /* fall through */
    }
  }
  const plain = dt.getData('text/plain')?.trim()
  if (plain && (plain.includes('/') || plain.includes('\\'))) {
    const name = plain.split(/[\\/]/).pop() || plain
    return { path: plain, name }
  }
  return null
}