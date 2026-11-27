import type { SessionTreeNode } from './session-tree-list'

export const TREE_COL_PX = 20
export const TREE_ROW_HEIGHT = 28
export const MAX_TREE_INDENT = 7

/** Low-saturation mineral/editorial palette for distinguishing sibling historical branches. */
export const TREE_BRANCH_PALETTE = [
  '#0284c7', // mineral sky
  '#d97706', // warm ochre
  '#7c3aed', // muted violet
  '#059669', // sage emerald
  '#db2777', // dusty rose
] as const

export function treeColX(col: number): number {
  return TREE_COL_PX / 2 + col * TREE_COL_PX
}

export function treeGutterWidth(col: number): number {
  return (col + 1) * TREE_COL_PX + 2
}

export interface TreeAncestorRail {
  col: number
  active: boolean
  color: string | null
}

export interface SessionTreeLayoutRow {
  node: SessionTreeNode
  /** Original index in the visibleNodes array (used by resolveViewTargetId). */
  sourceIndex: number
  /** Visual indent column (0..MAX_TREE_INDENT); linear chains stay flat, forks step +1. */
  col: number
  /** Uncapped logical branch depth for aria-level. */
  branchDepth: number
  parentId: string | null
  parentCol: number | null
  /** Parent has >= 2 visible children (renders a ├─ / ╰─ branch elbow). */
  isForkChild: boolean
  isLastChild: boolean
  /** Number of visible branches starting directly from this node (0 when < 2). */
  forkChildCount: number
  /** Assigned mineral branch color for historical branch differentiation (null on unbranched trunk). */
  branchColor: string | null
  /** Vertical guide lines for open ancestor branches to the left of this node. */
  ancestorRails: TreeAncestorRail[]
  /** Node lies on the active root -> leaf path computed from the full tree. */
  onActivePath: boolean
  /** Deepest visible node on the active path (highlights active branch even if leaf is filtered out). */
  isActiveTip: boolean
  /** Vertical trunk above a fork child's midpoint carries the active path. */
  upperTrunkActive: boolean
  /** Color of the parent trunk feeding into a fork child. */
  upperTrunkColor: string | null
  /** Vertical trunk below a non-last fork child's midpoint carries the active path. */
  lowerTrunkActive: boolean
  /** Color of the vertical trunk continuing to later siblings below a fork child. */
  lowerTrunkColor: string | null
  /** Row currently has unfolded visible children rendered below it. */
  hasVisibleChildren: boolean
  /** Any direct visible child of this row lies on the active path. */
  hasActiveChild: boolean
  /** Color of the downward stem leaving this row when not on the active path. */
  outgoingStemColor: string | null
  /** Node can be collapsed/expanded (branch start, branch point, or multi-root with descendants). */
  foldable: boolean
  isFolded: boolean
  /** Count of visible descendants hidden while folded (0 when expanded). */
  hiddenDescendantCount: number
  /** Folded node hides part of the active path inside its descendants. */
  foldedContainsActive: boolean
}

export interface SessionTreeLayout {
  rows: SessionTreeLayoutRow[]
  activePathIds: Set<string>
  visibleParentMap: Map<string, string | null>
  visibleChildrenMap: Map<string, string[]>
  foldableIds: Set<string>
  maxCol: number
  /** Total number of distinct leaf branches in the visible tree (1 for linear). */
  branchCount: number
  /** Total visible nodes before folding. */
  totalVisibleCount: number
}

/**
 * Resolve true parentId for every node in the full tree.
 * Uses explicit `parentId` when provided by main/worker; falls back to O(n) depth stack
 * for legacy/test fixtures that only carry `depth`.
 */
export function buildFullParentMap(allNodes: readonly SessionTreeNode[]): Map<string, string | null> {
  const idSet = new Set<string>()
  for (const n of allNodes) idSet.add(n.id)

  const parentMap = new Map<string, string | null>()
  const depthStack: Array<{ id: string; depth: number }> = []

  for (const n of allNodes) {
    let pid: string | null = null
    if (n.parentId !== undefined) {
      pid = n.parentId && n.parentId !== n.id && idSet.has(n.parentId) ? n.parentId : null
    } else {
      while (depthStack.length > 0 && depthStack[depthStack.length - 1].depth >= n.depth) {
        depthStack.pop()
      }
      pid = depthStack.length > 0 ? depthStack[depthStack.length - 1].id : null
    }
    parentMap.set(n.id, pid)
    depthStack.push({ id: n.id, depth: n.depth })
  }

  return parentMap
}

export function computeActivePathIds(
  allNodes: readonly SessionTreeNode[],
  parentMap: ReadonlyMap<string, string | null>,
): Set<string> {
  const ids = new Set<string>()
  if (!allNodes.length) return ids
  const leaf = allNodes.find((n) => n.isLeaf) ?? allNodes[allNodes.length - 1]
  let cur: string | null = leaf?.id ?? null
  while (cur && !ids.has(cur)) {
    ids.add(cur)
    cur = parentMap.get(cur) ?? null
  }
  return ids
}

export function buildSessionTreeLayout(
  visibleNodes: readonly SessionTreeNode[],
  options: {
    allNodes?: readonly SessionTreeNode[]
    foldedIds?: ReadonlySet<string>
  } = {},
): SessionTreeLayout {
  if (!visibleNodes.length) {
    return {
      rows: [],
      activePathIds: new Set(),
      visibleParentMap: new Map(),
      visibleChildrenMap: new Map(),
      foldableIds: new Set(),
      maxCol: 0,
      branchCount: 0,
      totalVisibleCount: 0,
    }
  }

  const fullNodes = options.allNodes && options.allNodes.length > 0 ? options.allNodes : visibleNodes
  const fullParentMap = buildFullParentMap(fullNodes)
  const activePathIds = computeActivePathIds(fullNodes, fullParentMap)

  const visibleById = new Map<string, { node: SessionTreeNode; sourceIndex: number }>()
  for (let i = 0; i < visibleNodes.length; i++) {
    const n = visibleNodes[i]
    if (!visibleById.has(n.id)) {
      visibleById.set(n.id, { node: n, sourceIndex: i })
    }
  }

  let visibleFallbackParents: Map<string, string | null> | null = null
  const getFullParent = (id: string): string | null => {
    if (fullParentMap.has(id)) return fullParentMap.get(id) ?? null
    if (!visibleFallbackParents) visibleFallbackParents = buildFullParentMap(visibleNodes)
    return visibleFallbackParents.get(id) ?? null
  }

  const visibleParentMap = new Map<string, string | null>()
  const visibleChildrenMap = new Map<string, string[]>()
  const visibleRoots: string[] = []

  for (const n of visibleNodes) {
    if (visibleParentMap.has(n.id)) continue
    let cur = getFullParent(n.id)
    const visited = new Set<string>([n.id])
    while (cur !== null && !visibleById.has(cur) && !visited.has(cur)) {
      visited.add(cur)
      cur = getFullParent(cur)
    }
    const resolvedParent = cur !== null && visibleById.has(cur) && !visited.has(cur) ? cur : null
    visibleParentMap.set(n.id, resolvedParent)
    if (resolvedParent === null) {
      visibleRoots.push(n.id)
    } else {
      const list = visibleChildrenMap.get(resolvedParent)
      if (list) list.push(n.id)
      else visibleChildrenMap.set(resolvedParent, [n.id])
    }
  }

  // Iterative pre/post-order traversal for descendant counts, active descendants, and leaf branch count.
  const order: string[] = []
  const preStack: string[] = [...visibleRoots].reverse()
  const seenOrder = new Set<string>()
  while (preStack.length > 0) {
    const id = preStack.pop()!
    if (seenOrder.has(id)) continue
    seenOrder.add(id)
    order.push(id)
    const kids = visibleChildrenMap.get(id)
    if (kids) {
      for (let i = kids.length - 1; i >= 0; i--) preStack.push(kids[i])
    }
  }

  const descendantCount = new Map<string, number>()
  const hasActiveDescendant = new Map<string, boolean>()
  let branchCount = 0
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const kids = visibleChildrenMap.get(id) ?? []
    if (kids.length === 0) branchCount += 1
    let count = 0
    let activeBelow = false
    for (const kid of kids) {
      count += 1 + (descendantCount.get(kid) ?? 0)
      if (activePathIds.has(kid) || hasActiveDescendant.get(kid)) {
        activeBelow = true
      }
    }
    descendantCount.set(id, count)
    hasActiveDescendant.set(id, activeBelow)
  }

  const foldableIds = new Set<string>()
  const multipleRoots = visibleRoots.length > 1
  for (const id of order) {
    const kids = visibleChildrenMap.get(id) ?? []
    if (kids.length === 0) continue
    const pid = visibleParentMap.get(id) ?? null
    const siblings = pid === null ? visibleRoots : (visibleChildrenMap.get(pid) ?? [])
    if (kids.length > 1 || siblings.length > 1 || (pid === null && multipleRoots)) {
      foldableIds.add(id)
    }
  }

  const folded = options.foldedIds
  const rows: SessionTreeLayoutRow[] = []
  let maxCol = 0
  let nextBranchColorIdx = 0

  interface Frame {
    id: string
    branchDepth: number
    col: number
    parentId: string | null
    parentCol: number | null
    isForkChild: boolean
    isLastChild: boolean
    branchColor: string | null
    ancestorRails: TreeAncestorRail[]
    upperTrunkActive: boolean
    upperTrunkColor: string | null
    lowerTrunkActive: boolean
    lowerTrunkColor: string | null
  }

  const pushSiblingFrames = (
    stack: Frame[],
    childIds: string[],
    parentId: string | null,
    parentCol: number | null,
    parentBranchDepth: number,
    parentBranchColor: string | null,
    parentRails: TreeAncestorRail[],
  ) => {
    const isFork = parentId !== null && childIds.length > 1
    const isMultiRoot = parentId === null && childIds.length > 1
    let activeChildIdx = -1
    for (let i = 0; i < childIds.length; i++) {
      if (activePathIds.has(childIds[i]) || hasActiveDescendant.get(childIds[i])) {
        activeChildIdx = i
      }
    }
    const nextBranchDepth = isFork ? parentBranchDepth + 1 : parentBranchDepth
    const nextCol =
      parentCol === null
        ? 0
        : isFork
          ? Math.min(MAX_TREE_INDENT, parentCol + 1)
          : parentCol

    // Assign stable sequential mineral colors in display order (top to bottom) for sibling branches.
    const siblingColors: Array<string | null> = childIds.map((cid) => {
      if (isFork || isMultiRoot) {
        if (activePathIds.has(cid) || hasActiveDescendant.get(cid)) {
          return parentBranchColor
        }
        const color = TREE_BRANCH_PALETTE[nextBranchColorIdx % TREE_BRANCH_PALETTE.length]
        nextBranchColorIdx += 1
        return color
      }
      return parentBranchColor
    })

    for (let i = childIds.length - 1; i >= 0; i--) {
      const hasLaterSibling = i < childIds.length - 1
      const laterColor = hasLaterSibling ? (siblingColors[i + 1] ?? parentBranchColor) : null
      stack.push({
        id: childIds[i],
        branchDepth: nextBranchDepth,
        col: nextCol,
        parentId,
        parentCol,
        isForkChild: isFork,
        isLastChild: i === childIds.length - 1,
        branchColor: siblingColors[i],
        ancestorRails: parentRails,
        upperTrunkActive: isFork && activeChildIdx >= i,
        upperTrunkColor: parentBranchColor,
        lowerTrunkActive: isFork && activeChildIdx > i,
        lowerTrunkColor: hasLaterSibling ? (parentBranchColor ?? laterColor) : null,
      })
    }
  }

  const stack: Frame[] = []
  pushSiblingFrames(stack, visibleRoots, null, null, 0, null, [])

  while (stack.length > 0) {
    const frame = stack.pop()!
    const entry = visibleById.get(frame.id)
    if (!entry) continue

    const kids = visibleChildrenMap.get(frame.id) ?? []
    const foldable = foldableIds.has(frame.id)
    const isFolded = foldable && Boolean(folded?.has(frame.id))
    const hasVisibleChildren = !isFolded && kids.length > 0
    const onActivePath = activePathIds.has(frame.id)
    const activeChild = kids.some((k) => activePathIds.has(k) || hasActiveDescendant.get(k))
    const foldedContainsActive = isFolded && (hasActiveDescendant.get(frame.id) ?? false)
    const isActiveTip = onActivePath && !activeChild && !foldedContainsActive

    if (frame.col > maxCol) maxCol = frame.col

    rows.push({
      node: entry.node,
      sourceIndex: entry.sourceIndex,
      col: frame.col,
      branchDepth: frame.branchDepth,
      parentId: frame.parentId,
      parentCol: frame.parentCol,
      isForkChild: frame.isForkChild,
      isLastChild: frame.isLastChild,
      forkChildCount: kids.length >= 2 ? kids.length : 0,
      branchColor: frame.branchColor,
      ancestorRails: frame.ancestorRails,
      onActivePath,
      isActiveTip,
      upperTrunkActive: frame.upperTrunkActive,
      upperTrunkColor: frame.upperTrunkColor,
      lowerTrunkActive: frame.lowerTrunkActive,
      lowerTrunkColor: frame.lowerTrunkColor,
      hasVisibleChildren,
      hasActiveChild: hasVisibleChildren && activeChild,
      outgoingStemColor: frame.branchColor,
      foldable,
      isFolded,
      hiddenDescendantCount: isFolded ? (descendantCount.get(frame.id) ?? 0) : 0,
      foldedContainsActive,
    })

    if (hasVisibleChildren) {
      let childRails = frame.ancestorRails
      if (frame.isForkChild && !frame.isLastChild && frame.parentCol !== null && frame.parentCol < frame.col) {
        const existingIdx = childRails.findIndex((r) => r.col === frame.parentCol)
        if (existingIdx >= 0) {
          childRails = childRails.map((r, idx) =>
            idx === existingIdx
              ? {
                  col: r.col,
                  active: r.active || frame.lowerTrunkActive,
                  color: r.color ?? frame.lowerTrunkColor,
                }
              : r,
          )
        } else {
          childRails = [
            ...childRails,
            {
              col: frame.parentCol,
              active: frame.lowerTrunkActive,
              color: frame.lowerTrunkColor,
            },
          ]
        }
      }
      pushSiblingFrames(stack, kids, frame.id, frame.col, frame.branchDepth, frame.branchColor, childRails)
    }
  }

  return {
    rows,
    activePathIds,
    visibleParentMap,
    visibleChildrenMap,
    foldableIds,
    maxCol,
    branchCount,
    totalVisibleCount: order.length,
  }
}
