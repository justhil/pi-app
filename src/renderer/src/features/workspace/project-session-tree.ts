import { workspacePathKey } from '@shared/workspace-path'
import type { SubagentSessionChild } from '@renderer/lib/subagent-session-types'
import type { SessionItem } from './project-sidebar-types'

export interface SessionNode {
  key: string
  session: SessionItem
  parentKey?: string
  children: SessionNode[]
  liveChildren: SubagentSessionChild[]
  liveChild?: SubagentSessionChild
}

export interface SessionChildGroup {
  parentSessionFile: string
  children: SubagentSessionChild[]
}

export function buildSessionTree(sessions: SessionItem[], groups: SessionChildGroup[] = []) {
  const byKey = new Map<string, SessionNode>()
  for (const session of sessions) {
    const key = workspacePathKey(session.sessionFile) || `session:${session.sessionId}`
    if (!byKey.has(key)) byKey.set(key, { key, session, children: [], liveChildren: [] })
  }
  const liveParents = new Map<string, string>()
  for (const group of groups) {
    for (const child of group.children) {
      if (child.sessionFile) liveParents.set(workspacePathKey(child.sessionFile), workspacePathKey(group.parentSessionFile))
    }
  }
  for (const node of byKey.values()) {
    const parentKey = workspacePathKey(node.session.parentSessionFile) || liveParents.get(node.key)
    const parent = parentKey ? byKey.get(parentKey) : undefined
    if (!parent) continue
    // Corrupt ancestry must not hide sessions or create a recursive render loop.
    let ancestor: SessionNode | undefined = parent
    while (ancestor && ancestor !== node) ancestor = ancestor.parentKey ? byKey.get(ancestor.parentKey) : undefined
    if (ancestor) continue
    node.parentKey = parent.key
    parent.children.push(node)
  }
  for (const group of groups) {
    const parent = byKey.get(workspacePathKey(group.parentSessionFile))
    if (!parent) continue
    const seen = new Set<string>()
    for (const child of group.children) {
      const key = workspacePathKey(child.sessionFile) || child.key
      if (seen.has(key)) continue
      seen.add(key)
      const listed = byKey.get(key)
      if (!listed) parent.liveChildren.push(child)
      else if (listed.parentKey === parent.key) listed.liveChild = child
    }
  }
  return { roots: [...byKey.values()].filter((node) => !node.parentKey), byKey }
}

export function matchesSessionQuery(session: SessionItem, query: string): boolean {
  return `${session.title} ${session.firstMessage || ''} ${session.sessionId}`.toLowerCase().includes(query.trim().toLowerCase())
}

export function filterSessionTree(nodes: SessionNode[], query: string): SessionNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  return nodes.flatMap((node) => {
    const children = filterSessionTree(node.children, q)
    const liveChildren = node.liveChildren.filter((child) => `${child.agent} ${child.task}`.toLowerCase().includes(q))
    return matchesSessionQuery(node.session, q) || children.length || liveChildren.length
      ? [{ ...node, children, liveChildren }]
      : []
  })
}
