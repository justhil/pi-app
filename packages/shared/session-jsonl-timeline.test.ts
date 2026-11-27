import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTimelinePageFromSessionFile,
  clearParsedTimelineBranchCache,
} from './session-jsonl-timeline'

function makeSessionJsonl(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

describe('buildTimelinePageFromSessionFile LRU cache', () => {
  const dirs: string[] = []

  afterEach(() => {
    clearParsedTimelineBranchCache()
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  it('reuses parsed branch across older-page pagination and invalidates when file changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-timeline-lru-'))
    dirs.push(dir)
    const file = join(dir, 's1.jsonl')
    const header = { type: 'session', version: 3, id: 's1', timestamp: '2026-01-01T00:00:00.000Z', cwd: dir }
    const entries = [
      header,
      { type: 'message', id: 'e1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'u1' } },
      { type: 'message', id: 'e2', parentId: 'e1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'a1' }] } },
      { type: 'message', id: 'e3', parentId: 'e2', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'user', content: 'u2' } },
      { type: 'message', id: 'e4', parentId: 'e3', timestamp: '2026-01-01T00:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } },
    ]
    writeFileSync(file, makeSessionJsonl(entries), 'utf8')

    const builder = vi.fn((branch: unknown[]) =>
      branch.map((e, i) => ({
        id: `row-${i}`,
        type: (e as { message?: { role?: string } })?.message?.role === 'user' ? 'user-message' : 'assistant-message',
      })),
    )

    // Page 1 (tail) parses once
    const p1 = await buildTimelinePageFromSessionFile(file, { offset: 0, limit: 2 }, builder)
    expect(p1.totalCount).toBe(4)
    expect(p1.items).toHaveLength(2)
    expect(builder).toHaveBeenCalledTimes(1)

    // Page 2 (older offset=2) hits LRU cache — zero re-parse!
    const p2 = await buildTimelinePageFromSessionFile(file, { offset: 2, limit: 2 }, builder)
    expect(p2.totalCount).toBe(4)
    expect(p2.items).toHaveLength(2)
    expect(p2.items[0]?.id).toBe('row-0')
    expect(builder).toHaveBeenCalledTimes(1)

    // Mutating the file changes size/mtime -> automatically invalidates cache
    const updated = [
      ...entries,
      { type: 'message', id: 'e5', parentId: 'e4', timestamp: '2026-01-01T00:00:05.000Z', message: { role: 'user', content: 'u3' } },
    ]
    writeFileSync(file, makeSessionJsonl(updated), 'utf8')
    const p3 = await buildTimelinePageFromSessionFile(file, { offset: 0, limit: 2 }, builder)
    expect(p3.totalCount).toBe(5)
    expect(builder).toHaveBeenCalledTimes(2)
  })
})
