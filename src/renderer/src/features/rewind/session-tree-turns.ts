import { buildFullParentMap } from './session-tree-layout'
import type { SessionTreeNode, TreeFilterMode } from './session-tree-list'

export interface TurnCardMeta {
  /** Final assistant reply paired into this user turn card. */
  replyNode?: SessionTreeNode
  /** Number of intermediate tool calls/results collapsed inside this turn. */
  toolSteps: number
  /** True when the user node or any absorbed reply/tool node is the active session leaf. */
  containsLeaf: boolean
  /** Entry ID to rewind to when continuing right after this turn's reply. */
  continueAfterId?: string
  /** IDs of all nodes absorbed into this turn card. */
  absorbedIds: string[]
}

export interface TurnAggregationResult {
  nodes: SessionTreeNode[]
  turnMetaById: Map<string, TurnCardMeta>
}

const HIDDEN_SETTINGS_TYPES = new Set([
  'label',
  'context_edit',
  'custom',
  'model_change',
  'thinking_level_change',
  'session_info',
  'usage',
])

function isToolResult(n: SessionTreeNode): boolean {
  return n.entryType === 'message' && n.role === 'toolResult'
}

/**
 * Denoise raw tree entries according to filter mode.
 * In 'default' mode, drops toolResult messages and pure tool-calling empty assistant steps
 * (assistant nodes with empty preview whose child is a toolResult) so real conversations stay clean.
 */
export function filterDenoisedTreeNodes(
  rawNodes: readonly SessionTreeNode[],
  mode: TreeFilterMode,
): SessionTreeNode[] {
  if (mode === 'all') return [...rawNodes]
  if (mode === 'user-only') {
    return rawNodes.filter((n) => n.entryType === 'message' && n.role === 'user')
  }
  if (mode === 'labeled-only') {
    return rawNodes.filter((n) => Boolean(n.label))
  }

  // Build parent -> children map to detect pure tool-call assistant steps.
  const parentMap = buildFullParentMap(rawNodes)
  const hasToolResultChild = new Set<string>()
  for (const n of rawNodes) {
    if (isToolResult(n)) {
      const pid = parentMap.get(n.id)
      if (pid) hasToolResultChild.add(pid)
    }
  }

  return rawNodes.filter((n) => {
    if (n.isLeaf) return true
    if (n.label) return true
    if (HIDDEN_SETTINGS_TYPES.has(n.entryType)) return false
    if (n.entryType === 'compaction' || n.entryType === 'branch_summary') return true
    if (n.entryType !== 'message') return false
    if (isToolResult(n)) return false
    if (n.role === 'assistant' && !n.preview?.trim() && hasToolResultChild.has(n.id)) {
      return false
    }
    return true
  })
}

/**
 * Plan A: aggregate each linear user -> (tool steps / settings)* -> assistant chain
 * into a single Turn Micro-Card while keeping every fork point, compaction, branch_summary,
 * labeled entry, and standalone retry branch 100% lossless.
 */
export function buildTurnAggregatedNodes(rawNodes: readonly SessionTreeNode[]): TurnAggregationResult {
  const turnMetaById = new Map<string, TurnCardMeta>()
  if (!rawNodes.length) return { nodes: [], turnMetaById }

  const parentMap = buildFullParentMap(rawNodes)
  const childrenById = new Map<string, SessionTreeNode[]>()
  for (const n of rawNodes) {
    const pid = parentMap.get(n.id)
    if (!pid) continue
    const list = childrenById.get(pid)
    if (list) list.push(n)
    else childrenById.set(pid, [n])
  }

  const absorbedIds = new Set<string>()

  for (const n of rawNodes) {
    if (n.entryType !== 'message' || n.role !== 'user') continue
    const chain: SessionTreeNode[] = []
    let cur: SessionTreeNode = n
    const visited = new Set<string>([n.id])

    while (true) {
      const kids = childrenById.get(cur.id) ?? []
      if (kids.length !== 1) break
      const next = kids[0]
      if (visited.has(next.id)) break
      if (next.label) break

      const isReplyOrTool =
        next.entryType === 'message' && (next.role === 'assistant' || next.role === 'toolResult')
      const isTransparentSetting = HIDDEN_SETTINGS_TYPES.has(next.entryType)
      if (!isReplyOrTool && !isTransparentSetting) break

      visited.add(next.id)
      chain.push(next)
      cur = next
    }

    const assistants = chain.filter((c) => c.entryType === 'message' && c.role === 'assistant')
    const toolResults = chain.filter((c) => isToolResult(c))

    // Prefer the last assistant reply with actual text; fall back to the last assistant node if all are empty.
    const replyNode =
      [...assistants].reverse().find((a) => Boolean(a.preview?.trim())) ??
      assistants[assistants.length - 1]

    const toolSteps = toolResults.length
    const containsLeaf = n.isLeaf || chain.some((c) => c.isLeaf)
    const continueAfterId = replyNode?.id ?? (chain.length > 0 ? chain[chain.length - 1].id : undefined)

    for (const c of chain) absorbedIds.add(c.id)
    turnMetaById.set(n.id, {
      replyNode,
      toolSteps,
      containsLeaf,
      continueAfterId,
      absorbedIds: chain.map((c) => c.id),
    })
  }

  // Filter remaining non-absorbed entries using the denoised conversation rules.
  const hasToolResultChild = new Set<string>()
  for (const n of rawNodes) {
    if (isToolResult(n)) {
      const pid = parentMap.get(n.id)
      if (pid) hasToolResultChild.add(pid)
    }
  }

  const nodes = rawNodes.filter((n) => {
    if (absorbedIds.has(n.id)) return false
    if (n.entryType === 'message' && n.role === 'user') return true
    if (n.isLeaf || n.label) return true
    if (HIDDEN_SETTINGS_TYPES.has(n.entryType)) return false
    if (n.entryType === 'compaction' || n.entryType === 'branch_summary') return true
    if (n.entryType !== 'message') return false
    if (isToolResult(n)) return false
    if (n.role === 'assistant' && !n.preview?.trim() && hasToolResultChild.has(n.id)) return false
    return true
  })

  return { nodes, turnMetaById }
}

/**
 * Filter visible tree nodes by search query while preserving all visible ancestors
 * of every matching node so the branch structure stays intact during search.
 */
export function filterTreeNodesByQuery(
  visibleNodes: readonly SessionTreeNode[],
  allNodes: readonly SessionTreeNode[],
  query: string,
  options: {
    turnMetaById?: ReadonlyMap<string, TurnCardMeta>
    getFallbackTitle?: (node: SessionTreeNode) => string
  } = {},
): { nodes: SessionTreeNode[]; matchedIds: Set<string> | null } {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return { nodes: [...visibleNodes], matchedIds: null }
  }

  const fullParentMap = buildFullParentMap(allNodes.length > 0 ? allNodes : visibleNodes)
  const visibleIdSet = new Set(visibleNodes.map((n) => n.id))
  const matchedIds = new Set<string>()
  const keepIds = new Set<string>()

  for (const n of visibleNodes) {
    const turnMeta = options.turnMetaById?.get(n.id)
    const haystack = [
      n.label,
      n.preview,
      turnMeta?.replyNode?.label,
      turnMeta?.replyNode?.preview,
      options.getFallbackTitle?.(n),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (tokens.every((tok) => haystack.includes(tok))) {
      matchedIds.add(n.id)
      keepIds.add(n.id)
      let cur = fullParentMap.get(n.id) ?? null
      const visited = new Set<string>([n.id])
      while (cur && !visited.has(cur)) {
        visited.add(cur)
        if (visibleIdSet.has(cur)) keepIds.add(cur)
        cur = fullParentMap.get(cur) ?? null
      }
    }
  }

  return {
    nodes: visibleNodes.filter((n) => keepIds.has(n.id)),
    matchedIds,
  }
}

/** Compact relative time label for tree cards (e.g. "12m", "3h", "2d", "11/25"). */
export function formatTreeNodeTime(timestamp?: string): string {
  if (!timestamp) return ''
  const ms = Date.parse(timestamp)
  if (!Number.isFinite(ms)) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (diffSec < 60) return '<1m'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
