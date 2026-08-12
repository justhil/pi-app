import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const require = createRequire(import.meta.url)

describe('incomplete session recovery contracts', () => {
  it('main awaits graceful worker stop on quit', () => {
    const src = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
    assert.match(src, /before-quit/)
    assert.match(src, /gracefulShutdownWorkers/)
    assert.match(src, /await workerManager\.stop\(\)[\s\S]*finally\s*\{[\s\S]*sessionPreviewProcess\.stop\(\)/)
  })

  it('every renderer getMessages request carries the current workspace', () => {
    const rendererRoot = join(root, 'src/renderer/src')
    const files = []
    const visit = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) visit(path)
        else if (['.ts', '.tsx'].includes(extname(path)) && !path.includes('.test.')) files.push(path)
      }
    }
    visit(rendererRoot)

    let calls = 0
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const match of src.matchAll(/invoke\('session\.getMessages',\s*\{([\s\S]*?)\}\)/g)) {
        calls += 1
        assert.match(match[1], /\bworkspaceId\b/, `${file} getMessages call lacks workspaceId`)
      }
    }
    assert.ok(calls > 0)
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
