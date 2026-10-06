/**
 * Normalize sessionFile paths for Map keys / equality.
 * Main process uses path.resolve + drive-letter casing; renderer often sees mixed
 * separators / casing from JSONL list vs worker events — strict === breaks routing.
 */
export function normalizeSessionFileKey(sessionFile: string | null | undefined): string {
  const raw = String(sessionFile || '').trim()
  if (!raw) return ''
  let key = raw.replace(/\\/g, '/')
  // Collapse duplicate slashes (keep leading // for UNC)
  if (key.startsWith('//')) {
    key = `//${key.slice(2).replace(/\/+/g, '/')}`
  } else {
    key = key.replace(/\/+/g, '/')
  }
  // Windows drive letter → uppercase for stable keys
  if (/^[a-zA-Z]:\//.test(key)) {
    key = key.charAt(0).toUpperCase() + key.slice(1)
  }
  return key
}

export function sessionFilesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normalizeSessionFileKey(a)
  const kb = normalizeSessionFileKey(b)
  if (!ka || !kb) return false
  return ka === kb
}
