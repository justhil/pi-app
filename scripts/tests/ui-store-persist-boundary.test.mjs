import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('UI store persistence boundary (F-14)', () => {
  it('partialize excludes transient timeline/session state', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/ui-store.ts'), 'utf8')
    const part = src.match(/partialize:\s*\(s\)\s*=>\s*\(\{[\s\S]*?\}\),/)?.[0] ?? ''
    assert.match(part, /currentWorkspace/)
    assert.match(part, /lastModel/)
    assert.doesNotMatch(part, /timeline/)
    assert.doesNotMatch(part, /sessionItems/)
    assert.doesNotMatch(part, /runState/)
  })
})