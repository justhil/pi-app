import { describe, expect, it } from 'vitest'
import { buildSessionTreeLayout } from '../session-tree-layout'
import {
  buildTurnAggregatedNodes,
  filterDenoisedTreeNodes,
  filterTreeNodesByQuery,
} from '../session-tree-turns'
import type { SessionTreeNode } from '../session-tree-list'

function entry(
  id: string,
  parentId: string | null,
  depth: number,
  extra: Partial<SessionTreeNode> = {},
): SessionTreeNode {
  return {
    id,
    parentId,
    depth,
    entryType: 'message',
    role: 'user',
    isLeaf: false,
    preview: id,
    ...extra,
  }
}

describe('buildTurnAggregatedNodes (Plan A)', () => {
  it('folds intermediate tool calls and final reply into one turn card while keeping forks intact', () => {
    const raw: SessionTreeNode[] = [
      entry('u1', null, 0, { role: 'user', preview: '排查超时问题' }),
      entry('a1-t1', 'u1', 1, { role: 'assistant', preview: '' }),
      entry('tr1', 'a1-t1', 2, { role: 'toolResult', preview: 'grep output...' }),
      entry('a1-t2', 'tr1', 3, { role: 'assistant', preview: '' }),
      entry('tr2', 'a1-t2', 4, { role: 'toolResult', preview: 'file content...' }),
      entry('a1-final', 'tr2', 5, { role: 'assistant', preview: '定位到连接池泄漏。' }),
      // Fork A after a1-final
      entry('u2a', 'a1-final', 6, { role: 'user', preview: '方案 A：加连接超时' }),
      entry('a2a', 'u2a', 7, { role: 'assistant', preview: '已配置 10s 超时。' }),
      // Fork B after a1-final (active)
      entry('u2b', 'a1-final', 6, { role: 'user', preview: '方案 B：改成复用长连接' }),
      entry('a2b', 'u2b', 7, { role: 'assistant', preview: '已切换为长连接复用。', isLeaf: true }),
    ]

    const { nodes, turnMetaById } = buildTurnAggregatedNodes(raw)
    expect(nodes.map((n) => n.id)).toEqual(['u1', 'u2a', 'u2b'])

    const u1Meta = turnMetaById.get('u1')!
    expect(u1Meta.replyNode?.id).toBe('a1-final')
    expect(u1Meta.toolSteps).toBe(2)
    expect(u1Meta.containsLeaf).toBe(false)
    expect(u1Meta.continueAfterId).toBe('a1-final')

    const u2bMeta = turnMetaById.get('u2b')!
    expect(u2bMeta.replyNode?.id).toBe('a2b')
    expect(u2bMeta.containsLeaf).toBe(true)

    const layout = buildSessionTreeLayout(nodes, { allNodes: raw })
    expect(layout.rows.map((r) => [r.node.id, r.parentId, r.col, r.forkChildCount])).toEqual([
      ['u1', null, 0, 2],
      ['u2a', 'u1', 1, 0],
      ['u2b', 'u1', 1, 0],
    ])
    expect(layout.rows[2].onActivePath).toBe(true)
    expect(layout.rows[2].isActiveTip).toBe(true)
  })

  it('preserves retry forks when a single user prompt has multiple direct assistant replies', () => {
    const raw: SessionTreeNode[] = [
      entry('u1', null, 0, { role: 'user', preview: '给我两个方案' }),
      entry('a1-v1', 'u1', 1, { role: 'assistant', preview: '第一次回答' }),
      entry('a1-v2', 'u1', 1, { role: 'assistant', preview: '重试后的回答', isLeaf: true }),
    ]

    const { nodes, turnMetaById } = buildTurnAggregatedNodes(raw)
    expect(nodes.map((n) => n.id)).toEqual(['u1', 'a1-v1', 'a1-v2'])
    expect(turnMetaById.get('u1')?.replyNode).toBeUndefined()

    const layout = buildSessionTreeLayout(nodes, { allNodes: raw })
    expect(layout.rows[0].forkChildCount).toBe(2)
    expect(layout.rows[1].col).toBe(1)
    expect(layout.rows[2].col).toBe(1)
  })

  it('keeps compaction and branch_summary nodes visible between turns', () => {
    const raw: SessionTreeNode[] = [
      entry('u1', null, 0, { role: 'user', preview: 'first' }),
      entry('a1', 'u1', 1, { role: 'assistant', preview: '' }),
      entry('c1', 'a1', 2, { entryType: 'compaction', role: undefined, preview: '' }),
      entry('u2', 'c1', 3, { role: 'user', preview: 'second' }),
      entry('a2', 'u2', 4, { role: 'assistant', preview: '', isLeaf: true }),
    ]

    const { nodes, turnMetaById } = buildTurnAggregatedNodes(raw)
    expect(nodes.map((n) => n.id)).toEqual(['u1', 'c1', 'u2'])
    expect(turnMetaById.get('u1')?.replyNode?.id).toBe('a1')
    expect(turnMetaById.get('u2')?.replyNode?.id).toBe('a2')
  })
})

describe('filterDenoisedTreeNodes', () => {
  it('strips toolResult and empty tool-calling assistant nodes in default mode', () => {
    const raw: SessionTreeNode[] = [
      entry('u1', null, 0, { role: 'user', preview: 'run tests' }),
      entry('a1-tool', 'u1', 1, { role: 'assistant', preview: '' }),
      entry('tr1', 'a1-tool', 2, { role: 'toolResult', preview: 'PASS' }),
      entry('a1-done', 'tr1', 3, { role: 'assistant', preview: 'All passed', isLeaf: true }),
    ]
    expect(filterDenoisedTreeNodes(raw, 'default').map((n) => n.id)).toEqual(['u1', 'a1-done'])
    expect(filterDenoisedTreeNodes(raw, 'all').map((n) => n.id)).toEqual(['u1', 'a1-tool', 'tr1', 'a1-done'])
  })
})

describe('filterTreeNodesByQuery', () => {
  it('matches reply summaries inside turn cards and keeps visible ancestors', () => {
    const raw: SessionTreeNode[] = [
      entry('u1', null, 0, { role: 'user', preview: '架构讨论' }),
      entry('a1', 'u1', 1, { role: 'assistant', preview: '好的' }),
      entry('u2a', 'a1', 2, { role: 'user', preview: '分支 A' }),
      entry('a2a', 'u2a', 3, { role: 'assistant', preview: '使用 Redis 缓存' }),
      entry('u2b', 'a1', 2, { role: 'user', preview: '分支 B' }),
      entry('a2b', 'u2b', 3, { role: 'assistant', preview: '使用 SQLite 落盘', isLeaf: true }),
    ]
    const { nodes, turnMetaById } = buildTurnAggregatedNodes(raw)
    const result = filterTreeNodesByQuery(nodes, raw, 'redis', { turnMetaById })
    expect(result.nodes.map((n) => n.id)).toEqual(['u1', 'u2a'])
    expect([...(result.matchedIds ?? [])]).toEqual(['u2a'])
  })
})
