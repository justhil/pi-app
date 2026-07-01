import { existsSync } from 'fs'

export type FlatTreeNode = {
  id: string
  parentId: string | null
  depth: number
  label?: string
  entryType: string
  timestamp?: string
  isLeaf: boolean
  role?: string
  preview?: string
}

const MAX_TREE_NODES = 4000
const PREVIEW_MAX = 96

function previewFromMsg(msg: any): string {
  const c = msg?.content
  if (typeof c === 'string') return c.trim().slice(0, PREVIEW_MAX)
  if (!Array.isArray(c)) return ''
  return c
    .filter((p: any) => p?.type === 'text')
    .map((p: any) => p.text || '')
    .join('')
    .trim()
    .slice(0, PREVIEW_MAX)
}

type SessionEntry = {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  message?: any
  targetId?: string
  label?: string
}

/** 轻量读 JSONL + 迭代建树，避免 SessionManager.open / 递归 walk 导致栈溢出。 */
export async function flattenTreeFromSessionFile(
  sessionFile: string,
  _cwd: string,
  leafIdOverride?: string | null,
): Promise<{ nodes: FlatTreeNode[]; leafId: string | null }> {
  if (!sessionFile || !existsSync(sessionFile)) {
    return { nodes: [], leafId: null }
  }

  const { pathToFileURL, fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
  const resolved = fileURLToPath(mainUrl)
  const pkgRoot = dirname(dirname(resolved))
  const smPath = join(pkgRoot, 'dist', 'core', 'session-manager.js')
  const sm: any = await import(pathToFileURL(smPath).href)

  const fileEntries = sm.loadEntriesFromFile(sessionFile) as SessionEntry[]
  const entries = fileEntries.filter((e) => e.type !== 'session' && e.id)

  const labelsById = new Map<string, string>()
  for (const e of entries) {
    if (e.type === 'label' && e.targetId) {
      labelsById.set(e.targetId, e.label ?? '')
    }
  }

  let leafId: string | null = leafIdOverride ?? null
  if (leafId == null) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.type === 'message' && e.message?.role === 'assistant') {
        leafId = e.id!
        break
      }
    }
    if (!leafId && entries.length > 0) {
      leafId = entries[entries.length - 1].id!
    }
  }

  type Node = { entry: SessionEntry; children: Node[] }
  const nodeMap = new Map<string, Node>()
  const roots: Node[] = []

  for (const entry of entries) {
    nodeMap.set(entry.id!, { entry, children: [] })
  }
  for (const entry of entries) {
    const node = nodeMap.get(entry.id!)!
    const pid = entry.parentId
    if (pid == null || pid === entry.id) {
      roots.push(node)
    } else {
      const parent = nodeMap.get(pid)
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
  }

  const sortTs = (a: Node, b: Node) =>
    new Date(a.entry.timestamp || 0).getTime() - new Date(b.entry.timestamp || 0).getTime()

  const stack: Node[] = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()!
    node.children.sort(sortTs)
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
  }

  const flat: FlatTreeNode[] = []
  const visitStack: { node: Node; depth: number }[] = roots.map((n) => ({ node: n, depth: 0 }))
  visitStack.reverse()

  while (visitStack.length > 0 && flat.length < MAX_TREE_NODES) {
    const { node, depth } = visitStack.pop()!
    const e = node.entry
    const id = e.id!
    const row: FlatTreeNode = {
      id,
      parentId: e.parentId ?? null,
      depth,
      label: labelsById.get(id) || undefined,
      entryType: e.type,
      timestamp: e.timestamp,
      isLeaf: id === leafId,
    }
    if (e.type === 'message' && e.message) {
      row.role = e.message.role
      row.preview = previewFromMsg(e.message)
    }
    flat.push(row)
    for (let i = node.children.length - 1; i >= 0; i--) {
      visitStack.push({ node: node.children[i], depth: depth + 1 })
    }
  }

  return { nodes: flat, leafId }
}