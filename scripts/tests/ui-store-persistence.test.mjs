import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ui-store persistence invariants', () => {
  it('persists layout/workspace prefs but not transient timeline/session state', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/ui-store.ts'), 'utf8')
    const partialize = src.slice(src.indexOf('partialize:'), src.indexOf('version: 1'))
    assert.match(partialize, /currentWorkspace: s\.currentWorkspace/)
    assert.match(partialize, /recentProjects: s\.recentProjects/)
    assert.doesNotMatch(partialize, /timelineItems/)
    assert.doesNotMatch(partialize, /sessions/)
    assert.doesNotMatch(partialize, /streamingAssistantId/)
  })
})