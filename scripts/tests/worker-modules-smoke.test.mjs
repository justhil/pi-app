import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker modularization (FMSM iter14)', () => {
  it('split modules exist and index imports them', () => {
    for (const f of ['worker-timeline.ts', 'worker-session-events.ts', 'worker-compaction-patch.ts']) {
      assert.ok(existsSync(join(root, 'src/worker', f)), f)
    }
    const index = readFileSync(join(root, 'src/worker/index.ts'), 'utf8')
    assert.match(index, /worker-timeline/)
    assert.match(index, /worker-session-events/)
    assert.match(index, /worker-compaction-patch/)
    assert.doesNotMatch(index, /function normalizeMessages\(/)
  })
})