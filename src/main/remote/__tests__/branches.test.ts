import { describe, expect, it } from 'vitest'
import { branchesFromTree, type TreeRow } from '../branches'

const row = (id: string, parentId: string | null, role: string, preview = id, ts = 0, entryType = 'message'): TreeRow => ({
  id,
  parentId,
  entryType,
  role,
  preview,
  timestamp: new Date(1_791_200_000_000 + ts * 1000).toISOString(),
})

describe('branchesFromTree', () => {
  // u1 → a1 → u2 → a2            (old branch)
  //          ↘ u3 → a3 → label   (current, leaf a3; a label entry after it)
  const rows = [
    row('u1', null, 'user', 'first', 1),
    row('a1', 'u1', 'assistant', '', 2),
    row('u2', 'a1', 'user', 'try retries', 3),
    row('a2', 'u2', 'assistant', '', 4),
    row('u3', 'a1', 'user', 'single flight', 5),
    row('a3', 'u3', 'assistant', 'done:  one  in flight', 6),
    row('l1', 'a3', '', '', 7, 'label'),
  ]

  it('one branch per tip, current first, with where it diverged', () => {
    expect(branchesFromTree(rows, 'a3')).toEqual([
      { leafId: 'a3', title: 'single flight', turns: 2, current: true, updatedAt: 1_791_200_007_000, reply: 'done: one in flight' },
      { leafId: 'a2', title: 'try retries', turns: 2, current: false, updatedAt: 1_791_200_004_000 },
    ])
  })

  it('a rewound leaf in the middle of the tree is its own branch', () => {
    const out = branchesFromTree(rows, 'a1')
    expect(out[0]).toMatchObject({ leafId: 'a1', title: 'first', turns: 1, current: true })
    expect(out.slice(1).map((b) => b.leafId)).toEqual(['a3', 'a2'])
    expect(out[1].divergedAt).toBeUndefined()
  })

  it('names the first own message when a branch has several after the split', () => {
    const more = [...rows, row('u4', 'a2', 'user', 'and log it', 8), row('a4', 'u4', 'assistant', '', 9)]
    expect(branchesFromTree(more, 'a3').find((b) => b.leafId === 'a4')).toMatchObject({ title: 'and log it', turns: 3, divergedAt: 'try retries' })
  })
})
