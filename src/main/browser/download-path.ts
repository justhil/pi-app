import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/** Strip path separators and control characters so a server-suggested name stays inside `dir`. */
export function sanitizeDownloadName(name: string): string {
  const cleaned = basename(name.replace(/[\\/]/g, '_')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'download'
}

/** First free path `dir/name`, `dir/name (1).ext`, ... — never overwrites an existing file. */
export function uniqueDownloadPath(dir: string, rawName: string, exists: (p: string) => boolean = existsSync): string {
  const name = sanitizeDownloadName(rawName)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = join(dir, name)
  for (let i = 1; exists(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}
