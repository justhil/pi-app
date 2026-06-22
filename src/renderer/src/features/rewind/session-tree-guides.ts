import type { SessionTreeNode } from './session-tree-list'

/** 祖先列是否继续向下画竖线（后面还有该层级的兄弟子树） */
export function ancestorVerticals(nodes: SessionTreeNode[], index: number): boolean[] {
  const depth = nodes[index]?.depth ?? 0
  const vertical: boolean[] = []
  for (let col = 0; col < depth; col++) {
    let draw = false
    for (let j = index + 1; j < nodes.length; j++) {
      if (nodes[j].depth <= col) break
      draw = true
      break
    }
    vertical.push(draw)
  }
  return vertical
}

/** 当前节点在其 depth 上是否为同级最后一个（下一节点 depth 更浅或没有） */
export function isLastSiblingAtDepth(nodes: SessionTreeNode[], index: number): boolean {
  const depth = nodes[index]?.depth ?? 0
  if (index >= nodes.length - 1) return true
  return nodes[index + 1].depth < depth
}

export const TREE_GUIDE_COL_PX = 14