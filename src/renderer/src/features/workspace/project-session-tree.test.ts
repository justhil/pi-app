import { describe, expect, it } from 'vitest'
import { buildSessionTree, filterSessionTree } from './project-session-tree'
import type { SessionItem } from './project-sidebar-types'

const row = (id: string, parent?: string): SessionItem => ({
  sessionId: id, sessionFile: `/sessions/${id}.jsonl`, parentSessionFile: parent ? `/sessions/${parent}.jsonl` : undefined,
  title: id, updatedAt: 1, modelId: '',
})

describe('session file ancestry', () => {
  it('groups arbitrary input order and nested descendants without changing root order', () => {
    const { roots } = buildSessionTree([row('grandchild', 'child'), row('other'), row('child', 'parent'), row('parent')])
    expect(roots.map(n => n.session.sessionId)).toEqual(['other', 'parent'])
    expect(roots[1].children[0].session.sessionId).toBe('child')
    expect(roots[1].children[0].children[0].session.sessionId).toBe('grandchild')
  })

  it('uses file identity, not session title or id, and deduplicates Windows paths', () => {
    const parent = { ...row('same'), sessionFile: 'D:/Sessions/Parent.jsonl' }
    const child = { ...row('child'), parentSessionFile: 'd:\\sessions\\parent.jsonl' }
    const { roots } = buildSessionTree([parent, { ...parent, sessionFile: 'd:/sessions/PARENT.jsonl' }, child, row('same')])
    expect(roots).toHaveLength(2)
    expect(roots[0].children[0].session.sessionId).toBe('child')
    expect(roots[1].children).toHaveLength(0)
    expect(buildSessionTree([row('Parent'), { ...row('child'), parentSessionFile: '/sessions/parent.jsonl' }]).roots).toHaveLength(2)
  })

  it('keeps missing parents and cyclic ancestry reachable instead of losing records', () => {
    const { roots } = buildSessionTree([row('orphan', 'absent'), row('self', 'self'), row('a', 'b'), row('b', 'a')])
    expect(roots.map(n => n.session.sessionId)).toEqual(['orphan', 'self', 'b'])
    expect(roots[2].children.map(n => n.session.sessionId)).toEqual(['a'])
  })

  it('merges live children with listed sessions once and keeps unpersisted children', () => {
    const live = { key: 'run:0', agent: 'scout', task: 'Inspect files', state: 'running' as const, sessionFile: '/sessions/child.jsonl' }
    const { roots } = buildSessionTree([row('parent'), row('child')], [{ parentSessionFile: '/sessions/parent.jsonl', children: [live, live, { ...live, key: 'run:1', sessionFile: undefined }] }])
    expect(roots).toHaveLength(1)
    expect(roots[0].children).toHaveLength(1)
    expect(roots[0].children[0].liveChild).toBe(live)
    expect(roots[0].liveChildren).toHaveLength(1)
  })

  it('does not move a persisted child to another live parent', () => {
    const { roots } = buildSessionTree([row('parent'), row('other'), row('child', 'parent')], [{
      parentSessionFile: '/sessions/other.jsonl', children: [{ key: 'run:0', agent: 'scout', task: '', state: 'running', sessionFile: '/sessions/child.jsonl' }],
    }])
    expect(roots[0].children).toHaveLength(1)
    expect(roots[1].children).toHaveLength(0)
    expect(roots[1].liveChildren).toHaveLength(0)
  })

  it('retains only matching descendants and their ancestors during search', () => {
    const { roots } = buildSessionTree([row('parent'), row('child', 'parent'), { ...row('leaf', 'child'), firstMessage: 'needle prompt' }, row('sibling', 'parent'), row('unrelated')])
    const filtered = filterSessionTree(roots, ' NEEDLE ')
    expect(filtered.map(n => n.session.sessionId)).toEqual(['parent'])
    expect(filtered[0].children.map(n => n.session.sessionId)).toEqual(['child'])
    expect(filtered[0].children[0].children[0].session.sessionId).toBe('leaf')
    expect(filterSessionTree(roots, 'absent')).toEqual([])
    expect(filterSessionTree(roots, '')).toBe(roots)
  })
})
