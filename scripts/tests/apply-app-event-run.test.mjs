import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('apply-app-event run handler', () => {
  it('handleRun handles phase state with model patch', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event-handlers.ts'), 'utf8')
    assert.match(src, /export function handleRun/)
    assert.match(src, /phase === 'state'/)
    assert.match(src, /event\.model/)
  })
})