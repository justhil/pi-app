import { describe, expect, it } from 'vitest'
import {
  MAX_TREE_INDENT,
  buildSessionTreeLayout,
} from '../session-tree-layout'
import { filterSessionTreeNodes, type SessionTreeNode } from '../session-tree-list'

function msg(
  id: string,
  role: 'user' | 'assistant',
  depth: number,
  extra: Partial<SessionTreeNode> = {},
): SessionTreeNode {
  return {
    id,
    depth,
    entryType: 'message',
    role,
    isLeaf: false,
    preview: id,
    ...extra,
  }
}

describe('buildSessionTreeLayout', () => {
  it('keeps linear conversations flat at col 0 with no foldable nodes', () => {
    const raw = [
      msg('u1', 'user', 0, { parentId: null }),
      msg('a1', 'assistant', 1, { parentId: 'u1' }),
      msg('u2', 'user', 2, { parentId: 'a1' }),
      msg('a2', 'assistant', 3, { parentId: 'u2', isLeaf: true }),
    ]
    const layout = buildSessionTreeLayout(raw, { allNodes: raw })
    expect(layout.rows.map((r) => r.col)).toEqual([0, 0, 0, 0])
    expect(layout.rows.every((r) => !r.isForkChild)).toBe(true)
    expect(layout.rows.every((r) => !r.foldable)).toBe(true)
    expect(layout.rows.every((r) => r.onActivePath)).toBe(true)
    expect(layout.rows[3].isActiveTip).toBe(true)
    expect(layout.maxCol).toBe(0)
  })

  it('re-projects user-only filtered nodes into a real branch tree and preserves active path (#150)', () => {
    const raw = [
      msg('u1', 'user', 0, { parentId: null }),
      msg('a1', 'assistant', 1, { parentId: 'u1' }),
      // Branch A from a1
      msg('u2a', 'user', 2, { parentId: 'a1' }),
      msg('a2a', 'assistant', 3, { parentId: 'u2a' }),
      msg('u3a', 'user', 4, { parentId: 'a2a' }),
      msg('a3a', 'assistant', 5, { parentId: 'u3a' }),
      // Branch B from a1 (active branch)
      msg('u2b', 'user', 2, { parentId: 'a1' }),
      msg('a2b', 'assistant', 3, { parentId: 'u2b' }),
      msg('u3b', 'user', 4, { parentId: 'a2b' }),
      msg('a3b', 'assistant', 5, { parentId: 'u3b', isLeaf: true }),
    ]

    const userOnly = filterSessionTreeNodes(raw, 'user-only')
    const layout = buildSessionTreeLayout(userOnly, { allNodes: raw })

    expect(layout.rows.map((r) => r.node.id)).toEqual(['u1', 'u2a', 'u3a', 'u2b', 'u3b'])
    expect(layout.rows.map((r) => r.parentId)).toEqual([null, 'u1', 'u2a', 'u1', 'u2b'])
    expect(layout.rows.map((r) => r.col)).toEqual([0, 1, 1, 1, 1])

    // u2a is first fork child (not last), u3a keeps an active ancestor rail on col 0 leading to u2b
    expect(layout.rows[1].isForkChild).toBe(true)
    expect(layout.rows[1].isLastChild).toBe(false)
    expect(layout.rows[1].upperTrunkActive).toBe(true)
    expect(layout.rows[1].lowerTrunkActive).toBe(true)
    expect(layout.rows[2].ancestorRails).toEqual([{ col: 0, active: true, color: null }])
    expect(layout.rows[0].forkChildCount).toBe(2)
    expect(layout.rows[1].branchColor).toBeTruthy()
    expect(layout.branchCount).toBe(2)

    // u2b is last fork child on the active branch; u3b is active tip even though assistant a3b was filtered out
    expect(layout.rows[3].isForkChild).toBe(true)
    expect(layout.rows[3].isLastChild).toBe(true)
    expect(layout.rows[3].onActivePath).toBe(true)
    expect(layout.rows[4].onActivePath).toBe(true)
    expect(layout.rows[4].isActiveTip).toBe(true)
    expect(layout.rows[1].onActivePath).toBe(false)

    // u1 (branch point), u2a (branch start with child u3a), u2b (branch start with child u3b) are foldable
    expect([...layout.foldableIds]).toEqual(['u1', 'u2a', 'u2b'])
  })

  it('infers parent relationships from depth when legacy fixtures omit parentId', () => {
    const raw = [
      msg('u1', 'user', 0),
      msg('a1', 'assistant', 1),
      msg('u2a', 'user', 2),
      msg('a2a', 'assistant', 3),
      msg('u2b', 'user', 2),
      msg('a2b', 'assistant', 3, { isLeaf: true }),
    ]
    const userOnly = filterSessionTreeNodes(raw, 'user-only')
    const layout = buildSessionTreeLayout(userOnly, { allNodes: raw })

    expect(layout.rows.map((r) => [r.node.id, r.parentId, r.col])).toEqual([
      ['u1', null, 0],
      ['u2a', 'u1', 1],
      ['u2b', 'u1', 1],
    ])
    expect(layout.rows[2].isActiveTip).toBe(true)
  })

  it('hides descendants and reports counts + active descendant indicator when folded', () => {
    const raw = [
      msg('u1', 'user', 0, { parentId: null }),
      msg('u2a', 'user', 1, { parentId: 'u1' }),
      msg('u3a', 'user', 2, { parentId: 'u2a' }),
      msg('u4a', 'user', 3, { parentId: 'u3a' }),
      msg('u2b', 'user', 1, { parentId: 'u1' }),
      msg('u3b', 'user', 2, { parentId: 'u2b', isLeaf: true }),
    ]

    const foldedA = buildSessionTreeLayout(raw, { allNodes: raw, foldedIds: new Set(['u2a']) })
    expect(foldedA.rows.map((r) => r.node.id)).toEqual(['u1', 'u2a', 'u2b', 'u3b'])
    expect(foldedA.rows[1].isFolded).toBe(true)
    expect(foldedA.rows[1].hiddenDescendantCount).toBe(2)
    expect(foldedA.rows[1].foldedContainsActive).toBe(false)

    const foldedB = buildSessionTreeLayout(raw, { allNodes: raw, foldedIds: new Set(['u2b']) })
    expect(foldedB.rows.map((r) => r.node.id)).toEqual(['u1', 'u2a', 'u3a', 'u4a', 'u2b'])
    expect(foldedB.rows[4].isFolded).toBe(true)
    expect(foldedB.rows[4].hiddenDescendantCount).toBe(1)
    expect(foldedB.rows[4].foldedContainsActive).toBe(true)
  })

  it('caps visual indentation at MAX_TREE_INDENT on deeply nested forks', () => {
    const raw: SessionTreeNode[] = [msg('r', 'user', 0, { parentId: null })]
    let parent = 'r'
    for (let level = 1; level <= 12; level++) {
      const a = `a${level}`
      const b = `b${level}`
      raw.push(msg(a, 'user', level, { parentId: parent }))
      raw.push(msg(b, 'user', level, { parentId: parent, isLeaf: level === 12 }))
      parent = b
    }

    const layout = buildSessionTreeLayout(raw, { allNodes: raw })
    expect(layout.maxCol).toBe(MAX_TREE_INDENT)
    expect(layout.rows.every((r) => r.col <= MAX_TREE_INDENT)).toBe(true)
  })
})
