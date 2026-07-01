import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('worker session model formatting', () => {
  it('worker uses formatSessionModelKey instead of session.model as any', () => {
    const src = readFileSync(join(root, 'src/worker/index.ts'), 'utf8')
    assert.match(src, /formatSessionModelKey/)
    assert.doesNotMatch(src, /\(session\.model as any\)/)
  })
})