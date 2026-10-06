import type { BranchInfo } from '@shared/remote'

/** One entry of the session tree (`flattenTreeFromSessionFile` rows, trimmed to what branches need). */
export type TreeRow = { id: string; parentId: string | null; entryType: string; role?: string; preview?: string; timestamp?: string }

const PREVIEW_MAX = 120

/**
 * The session's branches, newest first: one per tree tip that holds a user message. A branch's
 * `leafId` is its last message entry (what navigating to it selects); `current` marks the branch
 * the session's leaf is on; `divergedAt` is its first user message after it split from the current one.
 */
export function branchesFromTree(rows: TreeRow[], leafId: string | null): BranchInfo[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const hasChild = new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p))
  const path = (id: string): TreeRow[] => {
    const out: TreeRow[] = []
    const seen = new Set<string>()
    for (let r = byId.get(id); r && !seen.has(r.id); r = r.parentId ? byId.get(r.parentId) : undefined) {
      seen.add(r.id)
      out.push(r)
    }
    return out.reverse()
  }
  const lastMessage = (p: TreeRow[]) => [...p].reverse().find((r) => r.entryType === 'message')
  const currentPath = leafId && byId.has(leafId) ? path(leafId) : []
  const currentIds = new Set(currentPath.map((r) => r.id))
  const currentLast = lastMessage(currentPath)?.id
  const clip = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX)

  // Tips, plus the leaf itself when a rewind left it in the middle of the tree.
  const tips = rows.filter((r) => !hasChild.has(r.id)).map((r) => r.id)
  if (leafId && byId.has(leafId) && !tips.includes(leafId)) tips.push(leafId)

  const seenLeaves = new Set<string>()
  const out: BranchInfo[] = []
  for (const tip of tips) {
    const p = path(tip)
    const last = lastMessage(p)
    if (!last || seenLeaves.has(last.id)) continue
    const users = p.filter((r) => r.role === 'user')
    if (!users.length) continue
    seenLeaves.add(last.id)
    const current = last.id === currentLast
    const firstOwn = current ? undefined : p.find((r) => r.role === 'user' && !currentIds.has(r.id))
    const ts = Date.parse(p[p.length - 1].timestamp ?? '')
    const reply = clip([...p].reverse().find((r) => r.role === 'assistant' && r.preview?.trim())?.preview)
    out.push({
      leafId: last.id,
      title: clip(users[users.length - 1].preview) || '…',
      turns: users.length,
      current,
      ...(Number.isFinite(ts) ? { updatedAt: ts } : {}),
      ...(firstOwn && firstOwn !== users[users.length - 1] ? { divergedAt: clip(firstOwn.preview) } : {}),
      ...(reply ? { reply } : {}),
    })
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}
