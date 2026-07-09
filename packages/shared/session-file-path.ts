/**
 * Portable session JSONL path normalize / equality (main, worker, renderer).
 * Windows slash/case variants must not trigger loadSession dispose thrash.
 */

export function normalizeSessionFilePath(sessionFile: string | null | undefined): string {
  const raw = String(sessionFile || '').trim()
  if (!raw) return ''
  let key = raw.replace(/\\/g, '/')
  if (key.startsWith('//')) {
    key = `//${key.slice(2).replace(/\/+/g, '/')}`
  } else {
    key = key.replace(/\/+/g, '/')
  }
  if (/^[a-zA-Z]:\//.test(key)) {
    key = key.charAt(0).toUpperCase() + key.slice(1)
  }
  return key
}

export function sessionFilePathsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normalizeSessionFilePath(a)
  const kb = normalizeSessionFilePath(b)
  if (!ka || !kb) return false
  return ka === kb
}
