import { workspacePathsEqual } from '@shared/workspace-path'

export type DropEdge = 'before' | 'after'

/**
 * After a drag each conversation keeps a virtual time for its place (`rank`) until it is updated
 * after the drag (`at`, when the drag happened): a new message then sorts it to the top like any
 * other. The drag time, not the row's own time, marks that: the sidebar's copy of a time can be
 * older than the one read from disk later, which must not count as a new message.
 */
export type SessionRank = { rank: number; at: number }
export type SessionRanks = Record<string, SessionRank>

const STORAGE_KEY = 'pi-desktop:sidebar-session-order'

function effectiveRank(key: string, updatedAt: number, ranks: SessionRanks): number {
  const entry = ranks[key]
  return entry && updatedAt <= entry.at ? entry.rank : updatedAt
}

/** Newest first, with dragged conversations at their chosen place. Ties keep the given order. */
export function orderByRank<T>(items: T[], keyOf: (item: T) => string, updatedAtOf: (item: T) => number, ranks: SessionRanks): T[] {
  if (!Object.keys(ranks).length) return items
  return items
    .map((item, index) => ({ item, index, rank: effectiveRank(keyOf(item), updatedAtOf(item), ranks) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ item }) => item)
}

/**
 * Ranks after moving `from` next to `target` in `shown` (the list as displayed). The existing
 * times are handed out again in the new order, so anything updated later still sorts above them
 * all. Every shown conversation gets an entry, so the list keeps this order even when the times
 * read back from disk differ slightly from the ones on screen.
 */
export function moveRanked<T>(
  shown: T[],
  from: string,
  target: string,
  edge: DropEdge,
  keyOf: (item: T) => string,
  updatedAtOf: (item: T) => number,
  ranks: SessionRanks,
  now = Date.now(),
): SessionRanks {
  const keys = shown.map(keyOf)
  if (from === target || !keys.includes(from) || !keys.includes(target)) return ranks
  const ordered = keys.filter((key) => key !== from)
  ordered.splice(ordered.indexOf(target) + (edge === 'after' ? 1 : 0), 0, from)
  const values = shown.map((item) => effectiveRank(keyOf(item), updatedAtOf(item), ranks)).sort((a, b) => b - a)
  for (let i = 1; i < values.length; i++) if (values[i] >= values[i - 1]) values[i] = values[i - 1] - 0.001
  const next: SessionRanks = {}
  ordered.forEach((key, i) => {
    next[key] = { rank: values[i], at: now }
  })
  return next
}

export function readSessionRanks(projectKey: string): SessionRanks {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, SessionRanks>
    return all[projectKey] || {}
  } catch {
    return {}
  }
}

export function writeSessionRanks(projectKey: string, ranks: SessionRanks): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, SessionRanks>
    if (Object.keys(ranks).length) all[projectKey] = ranks
    else delete all[projectKey]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable: the order lasts for this window only */
  }
}

/**
 * The stored project list with the sidebar's top-level items (a project, or every checkout of
 * a repository group) in `items` order. Entries no item shows (temp chats, missing folders)
 * keep their relative order after them.
 */
export function arrangeRecentProjects(recent: string[], items: string[][]): string[] {
  const used = new Set<number>()
  const next: string[] = []
  for (const paths of items) {
    recent.forEach((entry, index) => {
      if (!used.has(index) && paths.some((path) => workspacePathsEqual(path, entry))) {
        used.add(index)
        next.push(entry)
      }
    })
  }
  recent.forEach((entry, index) => {
    if (!used.has(index)) next.push(entry)
  })
  return next
}

/** `items` with the one at `from` moved next to the one at `target`. */
export function moveItem<T>(items: T[], from: number, target: number, edge: DropEdge): T[] {
  if (from === target || from < 0 || target < 0 || from >= items.length || target >= items.length) return items
  const moved = items[from]
  const rest = items.filter((_, index) => index !== from)
  const at = rest.indexOf(items[target]) + (edge === 'after' ? 1 : 0)
  rest.splice(at, 0, moved)
  return rest
}

/** Which half of a row the pointer is over. */
export function dropEdgeAt(e: { clientY: number; currentTarget: Element }): DropEdge {
  const box = e.currentTarget.getBoundingClientRect()
  return e.clientY < box.top + box.height / 2 ? 'before' : 'after'
}

/**
 * What the sidebar is dragging. `dataTransfer` cannot be read during dragover, so rows check this
 * to decide whether they accept a drop; a drag to a split pane carries its own payload as before.
 */
export type SidebarDrag = { kind: 'session'; projectKey: string; key: string } | { kind: 'project'; key: string }
let currentDrag: SidebarDrag | null = null
export const setSidebarDrag = (drag: SidebarDrag | null) => {
  currentDrag = drag
}
export const getSidebarDrag = () => currentDrag
