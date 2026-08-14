import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnDiffEvent } from '@shared/app-events'

const tempDir = mkdtempSync(join(tmpdir(), 'pi-turn-persist-'))
vi.mock('electron', () => ({
  app: { getPath: () => join(tempDir, 'userData') },
}))

import { loadTurnDiffs, persistTurnDiff, removeTurnDiffs } from './turn-diff-persist'

function event(turnOrdinal: number, filesCount = 1): TurnDiffEvent {
  return {
    seq: 1,
    workspaceId: '/ws',
    sessionId: 's1',
    sessionFile: '/ws/sessions/s1.jsonl',
    runId: 'run-1',
    turnId: `turn-${turnOrdinal}`,
    turnOrdinal,
    timestamp: turnOrdinal,
    type: 'turn_diff',
    files: Array.from({ length: filesCount }, (_, i) => ({
      path: `/ws/f${turnOrdinal}-${i}.ts`,
      status: 'modified' as const,
      additions: 1,
      deletions: 0,
      diffText: `+line-${turnOrdinal}-${i}`,
    })),
  }
}

beforeEach(() => {
  rmSync(join(tempDir, 'userData'), { recursive: true, force: true })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('turn-diff-persist', () => {
  it('persists and reloads records across "restart" (module state is on disk)', () => {
    persistTurnDiff(event(1))
    persistTurnDiff(event(2, 2))

    const loaded = loadTurnDiffs('/ws/sessions/s1.jsonl')
    expect(loaded).toHaveLength(2)
    expect(loaded[0].turnOrdinal).toBe(1)
    expect(loaded[1].files).toHaveLength(2)
    expect(loaded[1].files[1].diffText).toBe('+line-2-1')
  })

  it('replaces an existing record for the same turn', () => {
    persistTurnDiff(event(1))
    const updated = event(1)
    updated.files[0].diffText = '+updated'
    persistTurnDiff(updated)

    const loaded = loadTurnDiffs('/ws/sessions/s1.jsonl')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].files[0].diffText).toBe('+updated')
  })

  it('trims to the last MAX_RECORDS_PER_SESSION records', () => {
    for (let i = 1; i <= 60; i++) persistTurnDiff(event(i))
    const loaded = loadTurnDiffs('/ws/sessions/s1.jsonl')
    expect(loaded).toHaveLength(50)
    expect(loaded[0].turnOrdinal).toBe(11)
    expect(loaded[49].turnOrdinal).toBe(60)
  })

  it('does not leak records across sessions', () => {
    persistTurnDiff(event(1))
    expect(loadTurnDiffs('/ws/sessions/other.jsonl')).toHaveLength(0)
  })

  it('removes records on session delete', () => {
    persistTurnDiff(event(1))
    removeTurnDiffs('/ws/sessions/s1.jsonl')
    expect(loadTurnDiffs('/ws/sessions/s1.jsonl')).toHaveLength(0)
  })

  it('writes jsonl files that are readable line-by-line', () => {
    persistTurnDiff(event(1))
    persistTurnDiff(event(2))
    const dirEntries = readdirSync(join(tempDir, 'userData', 'turn-diffs'))
    expect(dirEntries).toHaveLength(1)
    const raw = readFileSync(join(tempDir, 'userData', 'turn-diffs', dirEntries[0]), 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).turnOrdinal).toBe(1)
  })
})
