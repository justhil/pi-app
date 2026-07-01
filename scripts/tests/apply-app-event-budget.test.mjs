import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LINES = 120
const root = process.cwd()

describe('apply-app-event router budget', () => {
  it(`apply-app-event.ts <= ${MAX_LINES} lines`, () => {
    const path = join(root, 'src/renderer/src/stores/apply-app-event.ts')
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length
    assert.ok(lines <= MAX_LINES, `apply-app-event.ts has ${lines} lines, max ${MAX_LINES}`)
  })
  it('handlers live in apply-app-event-handlers.ts', () => {
    const src = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event.ts'), 'utf8')
    assert.match(src, /apply-app-event-handlers/)
    assert.doesNotMatch(src, /function handleMessage/)
    const barrel = readFileSync(join(root, 'src/renderer/src/stores/apply-app-event-handlers.ts'), 'utf8')
    assert.ok(barrel.split(/\r?\n/).length <= 15, 'handlers barrel stays thin')
  })
})