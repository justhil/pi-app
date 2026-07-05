import type { SessionTreeNode } from './session-tree-list'

/** 图谱列上限，防止侧栏/浮层被撑爆 */
export const MAX_GRAPH_LANES = 6
export const LANE_COL_PX = 11
export const GRAPH_RAIL_WIDTH = MAX_GRAPH_LANES * LANE_COL_PX + 6

export type GitLaneLayout = {
  lane: number[]
  parent: Array<number | null>
  pathIds: Set<string>
  continues: boolean[][]
  maxLanes: number
}

export function parentIndex(nodes: SessionTreeNode[], i: number): number | null {
  const d = nodes[i]?.depth ?? 0
  if (d <= 0) return null
  for (let j = i - 1; j >= 0; j--) {
    if (nodes[j].depth === d - 1) return j
  }
  return null
}

export function childrenIndices(nodes: SessionTreeNode[], i: number): number[] {
  const d = nodes[i]?.depth ?? 0
  const out: number[] = []
  for (let j = i + 1; j < nodes.length; j++) {
    if (nodes[j].depth <= d) break
    if (nodes[j].depth === d + 1) out.push(j)
  }
  return out
}

function pathToLeaf(nodes: SessionTreeNode[], parent: Array<number | null>): Set<string> {
  let leaf = nodes.findIndex((n) => n.isLeaf)
  if (leaf < 0 && nodes.length) leaf = nodes.length - 1
  const ids = new Set<string>()
  let i: number | null = leaf >= 0 ? leaf : null
  while (i != null && i >= 0) {
    ids.add(nodes[i].id)
    i = parent[i]
  }
  return ids
}

/** 为每个节点分配 git 轨道；首子沿用父轨道，其余兄弟占新轨道（封顶 MAX_GRAPH_LANES） */
export function assignGitLanes(nodes: SessionTreeNode[]): number[] {
  const lane = new Array<number>(nodes.length).fill(0)
  if (!nodes.length) return lane
  let nextLane = 1

  const visit = (i: number, L: number) => {
    lane[i] = Math.min(L, MAX_GRAPH_LANES - 1)
    const kids = childrenIndices(nodes, i)
    kids.forEach((k, ki) => {
      let childLane = ki === 0 ? L : nextLane++
      if (childLane >= MAX_GRAPH_LANES) childLane = MAX_GRAPH_LANES - 1
      visit(k, childLane)
    })
  }

  visit(0, 0)
  return lane
}

/** 行 i 上轨道 c 是否仍有未闭合的后继（画贯穿竖线） */
export function computeLaneContinues(nodes: SessionTreeNode[], lane: number[]): boolean[][] {
  const n = nodes.length
  const rows: boolean[][] = Array.from({ length: n }, () => Array(MAX_GRAPH_LANES).fill(false))
  for (let c = 0; c < MAX_GRAPH_LANES; c++) {
    for (let i = 0; i < n; i++) {
      if (lane[i] !== c) continue
      const d = nodes[i].depth
      for (let j = i + 1; j < n; j++) {
        if (nodes[j].depth < d) break
        if (nodes[j].depth === d && lane[j] === c) break
        if (lane[j] === c) {
          rows[i][c] = true
          break
        }
      }
    }
  }
  return rows
}

export function buildGitLaneLayout(nodes: SessionTreeNode[]): GitLaneLayout {
  const parent = nodes.map((_, i) => parentIndex(nodes, i))
  const lane = assignGitLanes(nodes)
  const pathIds = pathToLeaf(nodes, parent)
  const continues = computeLaneContinues(nodes, lane)
  const maxLanes = Math.min(MAX_GRAPH_LANES, Math.max(1, ...lane.map((l) => l + 1)))
  return { lane, parent, pathIds, continues, maxLanes }
}