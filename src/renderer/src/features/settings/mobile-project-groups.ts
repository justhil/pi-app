/** Project whitelist for the phone, grouped by parent folder so the list reads as names, not paths. */

export type ProjectGroup = { key: string; label: string; temporary?: boolean; projects: Array<{ path: string; name: string }> }

export const TEMPORARY_GROUP = 'temporary'

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** `/home/me/x` → `~/x`, `C:\Users\me\x` → `~\x`, WSL UNC stays as is. */
export function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^\/Users\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~')
}

/**
 * Folders grouped by parent; desktop temporary chats (sandbox dirs named by a random id) form one
 * group of their own, shown by chat title and listed last.
 */
export function projectGroups(
  paths: string[],
  info: Record<string, { label?: string; temporary?: boolean }> = {},
  temporaryLabel = 'Temporary chats',
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  const temporary: ProjectGroup = { key: TEMPORARY_GROUP, label: temporaryLabel, temporary: true, projects: [] }
  for (const path of paths) {
    const meta = info[path]
    if (meta?.temporary) {
      temporary.projects.push({ path, name: meta.label || norm(path).split('/').pop() || path })
      continue
    }
    const n = norm(path)
    const cut = n.lastIndexOf('/')
    const parentNorm = cut > 0 ? n.slice(0, cut) : '/'
    const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
    const parent = sep === '\\' ? parentNorm.replace(/\//g, '\\') : parentNorm
    const key = parentNorm.toLowerCase()
    const name = n.slice(cut + 1) || path
    let g = groups.get(key)
    if (!g) {
      g = { key, label: shortenHome(parent), projects: [] }
      groups.set(key, g)
    }
    g.projects.push({ path, name })
  }
  const out = [...groups.values()]
  for (const g of out) g.projects.sort((a, b) => a.name.localeCompare(b.name))
  // Bigger folders first (usually the workspace root), then alphabetical.
  out.sort((a, b) => b.projects.length - a.projects.length || a.label.localeCompare(b.label))
  if (temporary.projects.length) out.push(temporary)
  return out
}
