import { describe, it, expect } from 'vitest'
import { assignGitLanes, buildGitLaneLayout, parentIndex } from '../session-tree-git-lanes'
import type { SessionTreeNode } from '../session-tree-list'

function n(id: string, depth: number, extra: Partial<SessionTreeNode> = {}): SessionTreeNode {
  return { id, depth, entryType: 'message', isLeaf: false, role: 'user', ...extra }
}

describe('session-tree-git-lanes', () => {
  it('first child shares parent lane, sibling gets new lane', () => {
    const nodes = [n('a', 0), n('b', 1), n('c', 1)]
    expect(parentIndex(nodes, 1)).toBe(0)
    expect(parentIndex(nodes, 2)).toBe(0)
    const lane = assignGitLanes(nodes)
    expect(lane[1]).toBe(lane[0])
    expect(lane[2]).toBeGreaterThan(lane[1])
  })

  it('caps lanes at MAX_GRAPH_LANES', () => {
    const nodes: SessionTreeNode[] = [n('r', 0)]
    for (let i = 0; i < 12; i++) nodes.push(n(`s${i}`, 1))
    const lane = assignGitLanes(nodes)
    expect(Math.max(...lane)).toBeLessThan(6)
  })

  it('pathToLeaf includes ancestors', () => {
    const nodes = [
      n('a', 0),
      n('b', 1),
      n('c', 2, { isLeaf: true }),
    ]
    const { pathIds } = buildGitLaneLayout(nodes)
    expect(pathIds.has('a')).toBe(true)
    expect(pathIds.has('b')).toBe(true)
    expect(pathIds.has('c')).toBe(true)
  })
})