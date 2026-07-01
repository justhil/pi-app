import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LINES = 400
const root = process.cwd()

describe('ui-store.ts size budget (strict arch)', () => {
  it(`ui-store.ts line count <= ${MAX_LINES}`, () => {
    const path = join(root, 'src/renderer/src/stores/ui-store.ts')
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length
    assert.ok(lines <= MAX_LINES, `ui-store.ts has ${lines} lines, max ${MAX_LINES}`)
  })
})