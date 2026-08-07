import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('../config-store', () => ({
  configStore: {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value)
    },
  },
}))

import { archiveSessionsByRule, getArchivedAt, restoreSession, restoreSessions, restoreSessionsByRule } from '../session-archive'

const rows = [
  { path: '/sessions/a.jsonl', modified: new Date('2026-01-01T10:00:00') },
  { path: '/sessions/b.jsonl', modified: new Date('2026-03-15T10:00:00') },
  { path: '/sessions/c.jsonl', modified: new Date('2026-06-01T10:00:00') },
  { path: '/sessions/d.jsonl', modified: new Date('2026-09-01T10:00:00') },
]

describe('archiveSessionsByRule', () => {
  beforeEach(() => {
    store.clear()
    store.set('archivedSessions', {})
  })

  it('archives sessions modified before the given timestamp', () => {
    const before = new Date('2026-04-01T00:00:00').getTime()
    const archived = archiveSessionsByRule({ rows, before })
    expect(archived).toBe(2)
    expect(getArchivedAt('/sessions/a.jsonl')).toBeDefined()
    expect(getArchivedAt('/sessions/b.jsonl')).toBeDefined()
    expect(getArchivedAt('/sessions/c.jsonl')).toBeUndefined()
    expect(getArchivedAt('/sessions/d.jsonl')).toBeUndefined()
  })

  it('keeps only the most recent N sessions and archives the rest', () => {
    const archived = archiveSessionsByRule({ rows, keepRecent: 2 })
    expect(archived).toBe(2)
    // 最新两个（d, c）保留
    expect(getArchivedAt('/sessions/d.jsonl')).toBeUndefined()
    expect(getArchivedAt('/sessions/c.jsonl')).toBeUndefined()
    expect(getArchivedAt('/sessions/b.jsonl')).toBeDefined()
    expect(getArchivedAt('/sessions/a.jsonl')).toBeDefined()
  })

  it('never re-archives sessions that are already archived', () => {
    archiveSessionsByRule({ rows, before: new Date('2026-04-01T00:00:00').getTime() })
    const again = archiveSessionsByRule({ rows, before: new Date('2026-04-01T00:00:00').getTime() })
    expect(again).toBe(0)
  })

  it('returns 0 when no rule matches', () => {
    expect(archiveSessionsByRule({ rows })).toBe(0)
    expect(archiveSessionsByRule({ rows, before: 0 })).toBe(0)
  })

  it('re-archives a restored session when the rule matches again', () => {
    const before = new Date('2026-04-01T00:00:00').getTime()
    expect(archiveSessionsByRule({ rows, before })).toBe(2) // a, b
    restoreSession('/sessions/b.jsonl')
    expect(getArchivedAt('/sessions/b.jsonl')).toBeUndefined()
    // 恢复后 b 重新进入候选，再次执行同规则会把它归档回来
    expect(archiveSessionsByRule({ rows, before })).toBe(1)
    expect(getArchivedAt('/sessions/b.jsonl')).toBeDefined()
  })

  it('keepRecent=0 archives every session (0 = archive all)', () => {
    const archived = archiveSessionsByRule({ rows, keepRecent: 0 })
    expect(archived).toBe(4)
    expect(getArchivedAt('/sessions/a.jsonl')).toBeDefined()
    expect(getArchivedAt('/sessions/d.jsonl')).toBeDefined()
  })

  it('restoreSessions removes archive marks in one batch and returns the restored count', () => {
    archiveSessionsByRule({ rows, before: new Date('2026-04-01T00:00:00').getTime() }) // archives a, b
    expect(getArchivedAt('/sessions/a.jsonl')).toBeDefined()
    expect(getArchivedAt('/sessions/b.jsonl')).toBeDefined()

    const restored = restoreSessions(['/sessions/b.jsonl', '/sessions/c.jsonl', '/sessions/unknown.jsonl'])
    expect(restored).toBe(1)
    expect(getArchivedAt('/sessions/b.jsonl')).toBeUndefined()
    expect(getArchivedAt('/sessions/a.jsonl')).toBeDefined()

    // 全部恢复
    expect(restoreSessions(['/sessions/a.jsonl', '/sessions/a.jsonl'])).toBe(1)
    expect(getArchivedAt('/sessions/a.jsonl')).toBeUndefined()
    // 空/重复调用幂等
    expect(restoreSessions([])).toBe(0)
  })

  it('restoreSessionsByRule keeps the N most recently archived and restores the rest', () => {
    archiveSessionsByRule({ rows, keepRecent: 0 }) // 全部归档
    const paths = ['/sessions/a.jsonl', '/sessions/b.jsonl', '/sessions/c.jsonl', '/sessions/d.jsonl']

    const restored = restoreSessionsByRule({ paths, keepRecent: 1 })
    expect(restored).toBe(3) // 仅保留最近归档的 1 个
    const stillArchived = paths.filter((p) => getArchivedAt(p) != null)
    expect(stillArchived.length).toBe(1)
  })

  it('restoreSessionsByRule with keepRecent=0 restores all', () => {
    archiveSessionsByRule({ rows, keepRecent: 0 })
    const paths = ['/sessions/a.jsonl', '/sessions/b.jsonl', '/sessions/c.jsonl', '/sessions/d.jsonl']
    expect(restoreSessionsByRule({ paths, keepRecent: 0 })).toBe(4)
    for (const p of paths) expect(getArchivedAt(p)).toBeUndefined()
  })

  it('restoreSessionsByRule with keepRecent omitted restores all', () => {
    archiveSessionsByRule({ rows, keepRecent: 0 })
    const paths = ['/sessions/a.jsonl', '/sessions/b.jsonl']
    expect(restoreSessionsByRule({ paths })).toBe(2)
  })
})
