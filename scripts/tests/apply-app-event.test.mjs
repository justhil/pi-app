import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('apply-app-event module', () => {
  it('exports applyAppEvent and uses session guard', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event.ts'), 'utf8')
    assert.match(src, /export function applyAppEvent/)
    assert.match(src, /isSessionScopedAppEvent/)
  })

  it('ui-store delegates processEvent to applyAppEvent', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/ui-store.ts'), 'utf8')
    assert.match(src, /applyAppEvent/)
    assert.doesNotMatch(src, /switch\s*\(\s*event\.type\s*\)/)
  })
})