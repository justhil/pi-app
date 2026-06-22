import type { SessionTreeNode } from './session-tree-list'

/** 浮层/侧栏渲染上限，避免大树 + 引导线 O(n²) 卡死主线程 */
export const SESSION_TREE_UI_MAX = 320

export function capSessionTreeForDisplay(nodes: SessionTreeNode[]): {
  nodes: SessionTreeNode[]
  truncated: boolean
  hiddenCount: number
} {
  if (nodes.length <= SESSION_TREE_UI_MAX) {
    return { nodes, truncated: false, hiddenCount: 0 }
  }
  const hiddenCount = nodes.length - SESSION_TREE_UI_MAX
  const slice = nodes.slice(-SESSION_TREE_UI_MAX)
  const minDepth = Math.min(...slice.map((n) => n.depth))
  const nodesNorm = slice.map((n) => ({ ...n, depth: n.depth - minDepth }))
  return { nodes: nodesNorm, truncated: true, hiddenCount }
}