import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Strict arch: worker outbound model keys typed; remaining any is SDK message shapes (iter8+). */
const MAX_ANY = 30
const root = process.cwd()

describe('worker/index.ts as-any budget', () => {
  it(`as any count <= ${MAX_ANY}`, () => {
    const src = readFileSync(join(root, 'src/worker/index.ts'), 'utf8')
    const count = (src.match(/\sas any\b/g) || []).length
    assert.ok(count <= MAX_ANY, `worker has ${count} "as any", max ${MAX_ANY}`)
  })
})