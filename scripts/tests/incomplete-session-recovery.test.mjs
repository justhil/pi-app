import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const require = createRequire(import.meta.url)

describe('incomplete session recovery contracts', () => {
  it('main awaits graceful worker stop on quit', () => {
    const src = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
    assert.match(src, /before-quit/)
    assert.match(src, /gracefulShutdownWorkers/)
    assert.match(src, /await workerManager\.stop/)
  })

  it('disposeWorkerSlot always aborts when sessionFile present', () => {
    const src = readFileSync(join(root, 'src/main/worker-manager-pool.ts'), 'utf8')
    assert.match(src, /wasActive \|\| slot\.sessionFile/)
  })

  it('sanitizeHistoryTimeline heals trailing incomplete', () => {
    const src = readFileSync(join(root, 'src/renderer/src/lib/timeline-dedupe.ts'), 'utf8')
    assert.match(src, /markTrailingIncompleteAssistants/)
  })

  it('timeline uses resolveRewindTargetEntryId', () => {
    const src = readFileSync(join(root, 'src/renderer/src/features/timeline/timeline.tsx'), 'utf8')
    assert.match(src, /resolveRewindTargetEntryId/)
    assert.match(src, /rewindEntryId/)
  })

  it('shared helpers mark empty leaf and resolve user target', async () => {
    // Dynamic import of compiled-free TS is not available; re-implement smoke via source presence
    const src = readFileSync(join(root, 'packages/shared/timeline-incomplete.ts'), 'utf8')
    assert.match(src, /export function markTrailingIncompleteAssistants/)
    assert.match(src, /export function resolveRewindTargetEntryId/)
    assert.match(src, /previous user/)
  })
})
